import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { edits, items, projects, transcripts } from "@/db/schema";
import type { Word } from "@/lib/transcript/types";

/**
 * قراءة مقطع كامل بمراحله.
 *
 * كل استعلام مقيّد بـ `userId` — عزل البيانات على مستوى الاستعلام لا
 * على مستوى الواجهة، فلا يكشفه خطأ في مسار جديد.
 */
export async function loadItem(itemId: string, userId: string) {
  const [row] = await db
    .select({ item: items, project: projects })
    .from(items)
    .innerJoin(projects, eq(projects.id, items.projectId))
    .where(and(eq(items.id, itemId), eq(projects.userId, userId)))
    .limit(1);

  if (!row) return null;

  // النسخ المدموجة وحدها تُعرض؛ نسخ المقاطع الفرعية تفصيل تشغيلي
  // للاستئناف لا مادة للمقارنة.
  const stages = await db
    .select()
    .from(transcripts)
    .where(and(eq(transcripts.itemId, itemId), isNull(transcripts.segmentId)))
    .orderBy(asc(transcripts.createdAt));

  const editRows = await db
    .select()
    .from(edits)
    .where(eq(edits.itemId, itemId))
    .orderBy(asc(edits.paragraph));

  return { ...row, stages, edits: editRows };
}

export type LoadedItem = NonNullable<Awaited<ReturnType<typeof loadItem>>>;

/**
 * النصّ المعروض والمصدَّر.
 *
 * ترتيب الأفضلية: تعديل المستخدم اليدوي، ثم التدقيق، ثم المراجعة، ثم
 * التفريغ الخام. فالمقطع الذي وقف عند مرحلة ما يبقى قابلًا للعرض
 * والتصدير بأفضل ما وصل إليه، لا أن يظهر فارغًا.
 */
const STAGE_ORDER = ["export", "audit", "review", "transcribe"] as const;

export function bestText(stages: LoadedItem["stages"]): string {
  for (const stage of STAGE_ORDER) {
    const found = stages.filter((s) => s.stage === stage);
    if (found.length > 0) return found[found.length - 1]!.text;
  }
  return "";
}

/** الكلمات بتوقيتاتها — من مرحلة التفريغ وحدها، فهي صاحبة التوقيت. */
export function timedWords(stages: LoadedItem["stages"]): Word[] {
  const transcribed = stages
    .filter((s) => s.stage === "transcribe" && s.wordsJson)
    .sort((a, b) => (b.avgConfidence ?? 0) - (a.avgConfidence ?? 0));
  return (transcribed[0]?.wordsJson ?? []) as Word[];
}

/**
 * نصّ كل مرحلة للمقارنة جنبًا إلى جنب.
 * مرحلة `export` هي نسخة المستخدم بعد تحريره واعتماده.
 */
export function stageTexts(stages: LoadedItem["stages"]) {
  const pick = (stage: (typeof STAGE_ORDER)[number]) => {
    const found = stages.filter((s) => s.stage === stage);
    return found[found.length - 1] ?? null;
  };

  return {
    transcribe: pick("transcribe"),
    review: pick("review"),
    audit: pick("audit"),
    final: pick("export"),
  };
}
