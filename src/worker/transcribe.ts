import { join } from "node:path";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, glossary, items, projects, segments, transcripts } from "@/db/schema";
import { tidyOutput } from "@/lib/arabic";
import { extractSegment, readAndDiscard } from "@/lib/media/ffmpeg";
import { QuotaExhaustedError, providersFor, runProvider } from "@/lib/providers/registry";
import type { TranscriptionProvider } from "@/lib/providers/types";
import { diffTranscripts, disagreementRate } from "@/lib/transcript/diff";
import { mergeSegments, wordsToText, type SegmentTranscript } from "@/lib/transcript/merge";
import type { TranscriptResult, Word } from "@/lib/transcript/types";

/**
 * مرحلة التفريغ.
 *
 * كل محرّك متاح يفرّغ كل المقاطع الفرعية، ثم يُدمج مخرَج كل محرّك على
 * حدة، ثم يُقارن المخرجان. المقارنة هي الناتج الأثمن: ما اتفقا عليه
 * لا يُمسّ، وما اختلفا فيه هو ما تحكم فيه المراجعة (§2.1).
 *
 * المقاطع الفرعية تُعالج **بالتسلسل** لا بالتوازي: كل مقطع يحتاج سياق
 * سابقه، والتوازي يكون بين المقاطع الكاملة لا داخلها (§4.3).
 */
export async function transcribeItem(itemId: string): Promise<void> {
  const [item] = await db.select().from(items).where(eq(items.id, itemId)).limit(1);
  if (!item) throw new Error(`المقطع ${itemId} غير موجود`);
  if (!item.mediaPath) throw new Error("لا ملف وسائط — شغّل مرحلة التحضير أولًا.");

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, item.projectId))
    .limit(1);
  if (!project) throw new Error("المجلد غير موجود");

  const engines = providersFor(project.profile);
  if (engines.length === 0) {
    throw new Error(
      project.profile === "local_only"
        ? "وضع «مشروع خاص» يحتاج محرّكًا محليًا، ولا محرّك محلي مهيّأ بعد."
        : "لا مفاتيح مزوّدين مضبوطة. راجع GROQ_API_KEY و GEMINI_API_KEY.",
    );
  }

  const terms = await db
    .select({ term: glossary.term })
    .from(glossary)
    .where(eq(glossary.projectId, project.id));
  const glossaryTerms = terms.map((t) => t.term);

  const plans = await db
    .select()
    .from(segments)
    .where(eq(segments.itemId, itemId))
    .orderBy(asc(segments.index));
  if (plans.length === 0) throw new Error("لا خطة تقطيع — شغّل مرحلة التحضير أولًا.");

  await db
    .update(items)
    .set({ status: "transcribing", currentStage: "transcribe", errorMessage: null })
    .where(eq(items.id, itemId));

  // مخرج كل محرّك على حدة، مقطعًا مقطعًا.
  const byEngine = new Map<string, SegmentTranscript[]>();

  for (const plan of plans) {
    const chunkPath = join(item.mediaPath, "..", `seg-${plan.index}.wav`);
    await extractSegment(item.mediaPath, chunkPath, plan.startMs, plan.endMs);
    const audio = await readAndDiscard(chunkPath);
    const audioSeconds = (plan.endMs - plan.startMs) / 1000;

    for (const engine of engines) {
      const result = await transcribeChunk(engine, {
        audio,
        filename: `seg-${plan.index}.wav`,
        audioSeconds,
        glossary: glossaryTerms,
        languageHint: item.languageHint ?? "ar",
      }, itemId);

      if (!result) continue; // محرّك نفدت حصته أو فشل — نكمل بالباقي

      const list = byEngine.get(engine.name) ?? [];
      list.push({
        plan: {
          index: plan.index,
          startMs: plan.startMs,
          endMs: plan.endMs,
          overlapMs: plan.overlapMs,
        },
        words: result.words,
      });
      byEngine.set(engine.name, list);
    }
  }

  if (byEngine.size === 0) {
    throw new Error("لم ينجح أي محرّك في تفريغ أي مقطع فرعي.");
  }

  // دمج كل محرّك وحفظه نسخةً مستقلة
  const merged = new Map<string, Word[]>();
  for (const [engineName, parts] of byEngine) {
    const engine = engines.find((e) => e.name === engineName)!;
    const words = mergeSegments(parts);
    merged.set(engineName, words);

    await db.insert(transcripts).values({
      itemId,
      stage: "transcribe",
      engine: engineName,
      model: engine.model,
      text: tidyOutput(wordsToText(words)),
      wordsJson: words,
      avgConfidence: averageConfidence(words),
    });
  }

  // المرجع هو أول محرّك نجح، بترتيب الأفضلية لا بترتيب الوصول.
  const primaryName = engines.map((e) => e.name).find((n) => merged.has(n))!;
  const primary = merged.get(primaryName)!;
  const secondaryName = [...merged.keys()].find((n) => n !== primaryName);
  const secondary = secondaryName ? merged.get(secondaryName)! : null;

  const spans = secondary ? diffTranscripts(primary, secondary) : [];
  const difficulty = computeDifficulty(primary, spans.length, secondary !== null);

  await db.insert(auditLog).values({
    itemId,
    action: "transcribe",
    actor: "worker",
    detail: {
      engines: [...merged.keys()],
      words: primary.length,
      disagreements: spans.length,
      disagreementRate: secondary ? disagreementRate(spans, primary.length) : null,
      singleEngine: secondary === null,
    },
  });

  await db
    .update(items)
    .set({
      difficulty,
      // المراجعة (م3) لم تُبنَ بعد؛ إلى حينها يقف المقطع عند الاعتماد.
      status: "awaiting_approval",
      currentStage: "review",
    })
    .where(eq(items.id, itemId));
}

/**
 * نداء محرّك واحد لمقطع فرعي.
 * `null` تعني «تخطَّ هذا المحرّك لهذا المقطع» — نفاد الحصة ليس فشلًا
 * يُسقط المهمة كلها ما دام محرّك آخر يعمل.
 */
async function transcribeChunk(
  engine: TranscriptionProvider,
  input: Parameters<typeof runProvider>[1],
  itemId: string,
): Promise<TranscriptResult | null> {
  try {
    return await runProvider(engine, input, itemId);
  } catch (err) {
    if (err instanceof QuotaExhaustedError) return null;
    console.error(`[transcribe] ${engine.name} أخفق:`, err);
    return null;
  }
}

function averageConfidence(words: readonly Word[]): number | null {
  const scored = words.filter((w) => w.confidence !== undefined);
  if (scored.length === 0) return null;
  return scored.reduce((s, w) => s + w.confidence!, 0) / scored.length;
}

/**
 * درجة الصعوبة (‏0..1): تدني الثقة ونسبة اختلاف المحرّكين.
 * ترفع أولوية المقطع وتوسّع نطاق فحص المرحلة الثالثة (§5).
 */
function computeDifficulty(
  words: readonly Word[],
  disagreements: number,
  hadTwoEngines: boolean,
): number {
  const avg = averageConfidence(words);
  const confidencePart = avg === null ? 0.3 : 1 - avg;
  const diffPart = words.length === 0 ? 0 : Math.min(1, disagreements / words.length);

  // بمحرّك واحد لا دليل من الاختلاف، فنرفع الصعوبة احتياطًا.
  if (!hadTwoEngines) return Math.min(1, confidencePart * 0.5 + 0.5);
  return Math.min(1, confidencePart * 0.5 + diffPart * 0.5);
}
