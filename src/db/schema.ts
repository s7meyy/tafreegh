import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/* ─────────────── قوائم ثابتة ─────────────── */

/** نمط التفريغ — يحدّد ما يُعدّ «خطأ» في المراجعة (§2.4 من الخطة) */
export const transcriptionModeEnum = pgEnum("transcription_mode", [
  "verbatim", // حرفي: كل ما نُطق، بالتلعثم والتكرار
  "clean", // منقّح: حذف التلعثم، بقاء اللفظ العامي
  "formal", // مُفصَّح: تحويل العامية إلى فصحى
]);

/** ملف التشغيل — يحدّد أي مزوّدين يُستخدمون */
export const profileEnum = pgEnum("processing_profile", [
  "free_cloud", // Groq + Gemini (الافتراضي)
  "local_only", // faster-whisper + Ollama — لا يغادر المقطع الخادم
]);

export const sourceTypeEnum = pgEnum("source_type", ["upload", "youtube"]);

export const itemStatusEnum = pgEnum("item_status", [
  "queued",
  "fetching",
  "preparing",
  "transcribing",
  "reviewing_1",
  "reviewing_2",
  "awaiting_approval",
  "approved",
  "archived",
  "failed",
  "canceled",
]);

/** مرحلة في خط الإنتاج — يُستخدم في transcripts و jobs */
export const stageEnum = pgEnum("stage", [
  "fetch",
  "prepare",
  "transcribe",
  "review",
  "audit",
  "export",
  "cleanup",
]);

export const jobStateEnum = pgEnum("job_state", [
  "waiting",
  "active",
  "deferred", // مؤجّلة لنفاد الحصة — ليست فشلًا
  "completed",
  "failed",
]);

/** سبب التعديل — قائمة مغلقة. أي تعديل بسبب خارجها يُرفض (§5 المرحلة 2) */
export const editReasonEnum = pgEnum("edit_reason", [
  "glossary",
  "low_confidence",
  "engine_disagreement",
  "orthography",
  "punctuation",
  "disfluency",
]);

export const editVerdictEnum = pgEnum("edit_verdict", [
  "pending",
  "accepted",
  "rejected",
  "replaced",
]);

/* ─────────────── الجداول ─────────────── */

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    transcriptionMode: transcriptionModeEnum("transcription_mode")
      .notNull()
      .default("clean"),
    profile: profileEnum("profile").notNull().default("free_cloud"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("projects_user_idx").on(t.userId)],
);

/** مسرد المشروع — أسماء الأعلام والمصطلحات، يُمرّر للمحرّك وللمراجعة */
export const glossary = pgTable(
  "glossary",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    term: text("term").notNull(),
    /** أشكال خاطئة شائعة يصحّحها المسرد إلى `term` */
    variants: text("variants").array().notNull().default([]),
    note: text("note"),
  },
  (t) => [uniqueIndex("glossary_project_term_idx").on(t.projectId, t.term)],
);

export const items = pgTable(
  "items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    sourceType: sourceTypeEnum("source_type").notNull(),
    sourceUrl: text("source_url"),
    /** SHA-256 لمحتوى الملف — يمنع تفريغ المكرر مرتين */
    contentHash: text("content_hash"),
    mediaPath: text("media_path"),
    durationSec: integer("duration_sec"),
    languageHint: text("language_hint").default("ar"),

    status: itemStatusEnum("status").notNull().default("queued"),
    currentStage: stageEnum("current_stage"),
    errorMessage: text("error_message"),

    /** نسبة اختلاف المحرّكين + تدني الثقة — تحدّد نطاق التدقيق */
    difficulty: real("difficulty"),
    /** صفر للمزوّدين المجانيين؛ العمود موجود لو أُضيف مزوّد مدفوع */
    costCents: integer("cost_cents").notNull().default(0),

    approvedAt: timestamp("approved_at", { withTimezone: true }),
    mediaDeletedAt: timestamp("media_deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("items_project_idx").on(t.projectId),
    index("items_status_idx").on(t.status),
    index("items_hash_idx").on(t.contentHash),
  ],
);

/** المقاطع الفرعية — التقطيع عند الصمت بتداخل (§2.3) */
export const segments = pgTable(
  "segments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    index: integer("index").notNull(),
    startMs: integer("start_ms").notNull(),
    endMs: integer("end_ms").notNull(),
    /** مقدار التداخل مع المقطع السابق، بالمللي ثانية */
    overlapMs: integer("overlap_ms").notNull().default(0),
    mediaPath: text("media_path"),
  },
  (t) => [uniqueIndex("segments_item_index_idx").on(t.itemId, t.index)],
);

/** نسخة نصية واحدة لكل (مقطع، مرحلة، محرّك) — المراحل محفوظة كلها للمقارنة */
export const transcripts = pgTable(
  "transcripts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    stage: stageEnum("stage").notNull(),
    /** اسم المزوّد: groq | gemini | local | ollama */
    engine: text("engine").notNull(),
    model: text("model").notNull(),
    text: text("text").notNull(),
    /** الكلمات وتوقيتاتها ودرجات ثقتها — مصدر التنقّل الصوتي والتصدير srt/vtt */
    wordsJson: jsonb("words_json"),
    avgConfidence: real("avg_confidence"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("transcripts_item_stage_idx").on(t.itemId, t.stage)],
);

/** كل تعديل تقترحه المراجعة — بسببه وحكم التدقيق عليه */
export const edits = pgTable(
  "edits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    fromStage: stageEnum("from_stage").notNull(),
    paragraph: integer("paragraph").notNull(),
    before: text("before").notNull(),
    after: text("after").notNull(),
    reason: editReasonEnum("reason").notNull(),
    confidence: real("confidence"),
    verdict: editVerdictEnum("verdict").notNull().default("pending"),
    verdictNote: text("verdict_note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("edits_item_idx").on(t.itemId)],
);

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    segmentId: uuid("segment_id").references(() => segments.id, {
      onDelete: "cascade",
    }),
    stage: stageEnum("stage").notNull(),
    state: jobStateEnum("state").notNull().default("waiting"),
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
    /** متى يُعاد المحاولة — يُستخدم عند التأجيل لنفاد الحصة */
    retryAfter: timestamp("retry_after", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("jobs_item_stage_idx").on(t.itemId, t.stage)],
);

/** استهلاك الحصص — أساس لوحة الحصص والتنازل التلقائي (§3.3) */
export const usage = pgTable(
  "usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itemId: uuid("item_id").references(() => items.id, {
      onDelete: "set null",
    }),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    requests: integer("requests").notNull().default(1),
    audioSeconds: integer("audio_seconds").notNull().default(0),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    latencyMs: integer("latency_ms"),
    ok: boolean("ok").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("usage_provider_time_idx").on(t.provider, t.createdAt)],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itemId: uuid("item_id").references(() => items.id, {
      onDelete: "set null",
    }),
    action: text("action").notNull(),
    actor: text("actor").notNull(),
    detail: jsonb("detail"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("audit_item_idx").on(t.itemId)],
);
