/**
 * تجربة المسار كاملًا على ملف صوتي حقيقي، بالنماذج الحقيقية.
 *
 *   npm run trial -- مقابلة.mp3 [--ref النص-المرجعي.txt] [--speakers "المحاور، الضيف"]
 *
 * يحتاج العامل شغّالًا (npm run worker:start)، ومفتاحي GROQ_API_KEY و
 * GEMINI_API_KEY (أو المسار المحلي). يُنشئ مجلدًا «تجارب» لأول مستخدم،
 * ويرفع إليه الملف، ويتابع المراحل حتى «بانتظار اعتمادك»، ثم يطبع
 * تقريرًا: الفقرات والمتحدثون ومواضع الشك والتعديلات والحصة المستهلكة،
 * ومعدل خطأ الكلمة في كل مرحلة إن أُعطي نصّ مرجعي.
 *
 * المقطع يبقى في الموقع بلا اعتماد، فيُراجَع من المتصفح كأي مقطع.
 */
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { db } from "../src/db";
import { auditLog, edits, items, projects, transcripts, usage, users } from "../src/db/schema";
import { wordErrorRate } from "../src/lib/arabic";
import { env } from "../src/lib/env";
import { transcriptionProviders } from "../src/lib/providers/registry";
import { enqueuePrepare } from "../src/lib/queue";
import { isReviewConfigured } from "../src/lib/review/provider";
import type { EvidenceSpan } from "../src/lib/review/types";
import { adoptUpload } from "../src/lib/storage";
import { speakersIn, splitParagraphs, stripSpeakers } from "../src/lib/transcript/speakers";

const TIMEOUT_MS = 90 * 60_000;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const file = process.argv.slice(2).find((a, i, all) => !a.startsWith("--") && !all[i - 1]?.startsWith("--"));
  if (!file) {
    console.error('الاستعمال: npm run trial -- ملف.mp3 [--ref مرجع.txt] [--speakers "أ، ب"]');
    process.exit(2);
  }

  // ما الذي سيعمل فعلًا؟ تجربة بلا مفاتيح تقيس المحاكاة لا النماذج.
  const engines = transcriptionProviders().filter((p) => p.isConfigured()).map((p) => p.name);
  console.log(`المحرّكات المتاحة: ${engines.join("، ") || "لا شيء"}`);
  if (env().DEMO_MODE) console.log("تنبيه: DEMO_MODE مفعّل — النتائج محاكاة لا نماذج حقيقية.");
  if (engines.length === 0 || !isReviewConfigured()) {
    console.error("لا محرّك تفريغ أو لا مراجعة مضبوطة. اضبط GROQ_API_KEY و GEMINI_API_KEY في .env.");
    process.exit(1);
  }
  if (engines.length < 2) {
    console.log("تنبيه: محرّك واحد — لا أدلة اختلاف، والمراجعة تعتمد على الثقة وحدها.");
  }

  const [user] = await db.select().from(users).orderBy(asc(users.createdAt)).limit(1);
  if (!user) throw new Error("لا مستخدم — أنشئ حسابًا من /setup أولًا.");

  const speakers = (arg("speakers") ?? "")
    .split(/[،,]/)
    .map((s) => s.trim())
    .filter(Boolean);

  let [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.userId, user.id), eq(projects.name, "تجارب")))
    .limit(1);
  if (!project) {
    [project] = await db.insert(projects).values({ userId: user.id, name: "تجارب", speakers }).returning();
  } else if (speakers.length) {
    await db.update(projects).set({ speakers }).where(eq(projects.id, project.id));
  }

  const [item] = await db
    .insert(items)
    .values({
      projectId: project!.id,
      title: basename(file).replace(/\.[^.]+$/, ""),
      sourceType: "upload",
      status: "queued",
      currentStage: "prepare",
    })
    .returning();

  // نسخة لا نقل: الملف الأصلي يبقى حيث هو.
  const staging = join(env().STORAGE_DIR, "uploads");
  await mkdir(staging, { recursive: true });
  const temp = join(staging, `trial-${item!.id}`);
  await copyFile(file, temp);
  const mediaPath = await adoptUpload(item!.id, temp, basename(file));
  await db.update(items).set({ mediaPath }).where(eq(items.id, item!.id));
  await enqueuePrepare(item!.id);

  console.log(`\nالمقطع: ${item!.id}\nيتابَع حتى ينتظر الاعتماد… (العامل يجب أن يعمل)\n`);

  const started = Date.now();
  let last = "";
  for (;;) {
    const [row] = await db.select().from(items).where(eq(items.id, item!.id));
    if (row!.status !== last) {
      last = row!.status;
      console.log(`[${((Date.now() - started) / 1000).toFixed(0)}ث] ${last}`);
    }
    if (last === "awaiting_approval") break;
    if (last === "failed") {
      console.error(`فشل: ${row!.errorMessage}`);
      process.exit(1);
    }
    if (Date.now() - started > TIMEOUT_MS) throw new Error("انتهت المهلة");
    await new Promise((r) => setTimeout(r, 3000));
  }

  await report(item!.id, arg("ref"));
  process.exit(0);
}

async function report(itemId: string, refPath?: string) {
  const reference = refPath ? (await readFile(refPath, "utf8")).trim() : null;
  const [item] = await db.select().from(items).where(eq(items.id, itemId));
  const stages = await db
    .select()
    .from(transcripts)
    .where(and(eq(transcripts.itemId, itemId), isNull(transcripts.segmentId)))
    .orderBy(asc(transcripts.createdAt));

  console.log(`\n══ ${item!.title} ══`);
  for (const s of stages) {
    const wer = reference ? ` · خطأ الكلمة ${(wordErrorRate(reference, stripSpeakers(s.text)) * 100).toFixed(2)}%` : "";
    const conf = s.avgConfidence != null ? ` · ثقة ${(s.avgConfidence * 100).toFixed(0)}%` : "";
    console.log(`${s.stage.padEnd(10)} ${s.engine.padEnd(8)} ${splitParagraphs(s.text).length} فقرة${conf}${wer}`);
  }

  const audit = stages.filter((s) => s.stage === "audit").at(-1);
  if (audit) {
    const who = [...speakersIn(audit.text)];
    console.log(`المتحدثون: ${who.join("، ") || "لم يُميَّزوا"}`);
  }

  const [log] = await db
    .select({ detail: auditLog.detail })
    .from(auditLog)
    .where(and(eq(auditLog.itemId, itemId), eq(auditLog.action, "review")))
    .orderBy(desc(auditLog.createdAt))
    .limit(1);
  const detail = (log?.detail ?? {}) as Record<string, unknown> & { unresolvedSpans?: EvidenceSpan[] };
  const spans = detail.unresolvedSpans ?? [];
  const bySeverity = { high: 0, medium: 0, low: 0 };
  for (const s of spans) bySeverity[s.severity ?? "medium"]++;
  console.log(
    `المراجعة: أدلة ${detail.evidence} · اقتُرح ${detail.proposed} · رفض الحارس ${detail.rejectedByGuard} · طُبّق ${detail.applied}`,
  );
  console.log(`مواضع للمستخدم: ${spans.length} (شديدة ${bySeverity.high} · متوسطة ${bySeverity.medium} · خفيفة ${bySeverity.low})`);

  const rows = await db.select().from(edits).where(eq(edits.itemId, itemId));
  const tally = new Map<string, number>();
  for (const e of rows) {
    const k = `${e.reason} ${e.verdict}${e.verdictNote?.startsWith("الحارس") ? " (الحارس)" : ""}`;
    tally.set(k, (tally.get(k) ?? 0) + 1);
  }
  console.log("التعديلات:");
  for (const [k, n] of [...tally].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${n}`);

  const used = await db.select().from(usage).where(eq(usage.itemId, itemId));
  const byProvider = new Map<string, { requests: number; seconds: number; failed: number }>();
  for (const u of used) {
    const agg = byProvider.get(u.provider) ?? { requests: 0, seconds: 0, failed: 0 };
    agg.requests += u.requests;
    agg.seconds += u.audioSeconds ?? 0;
    if (!u.ok) agg.failed++;
    byProvider.set(u.provider, agg);
  }
  console.log("الحصة المستهلكة:");
  for (const [p, a] of byProvider) {
    console.log(`  ${p}: ${a.requests} طلب · ${Math.round(a.seconds / 60)} دقيقة صوت${a.failed ? ` · ${a.failed} فاشل` : ""}`);
  }

  console.log(`\nافتح المقطع للمراجعة والاعتماد: /items/${itemId}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
