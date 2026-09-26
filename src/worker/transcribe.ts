import { join } from "node:path";
import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, glossary, items, projects, segments, transcripts } from "@/db/schema";
import { ConfigError, QuotaExhaustedError } from "@/lib/errors";
import { extractSegment, readAndDiscard } from "@/lib/media/ffmpeg";
import { providersFor, runProvider } from "@/lib/providers/registry";
import type { TranscriptionProvider } from "@/lib/providers/types";
import { enqueueReview } from "@/lib/queue";
import { diffTranscripts, disagreementRate } from "@/lib/transcript/diff";
import { composeText } from "@/lib/review/document";
import { layoutParagraphs } from "@/lib/transcript/layout";
import { mergeSegments, type SegmentTranscript } from "@/lib/transcript/merge";
import { transferSpeakers } from "@/lib/transcript/speakers";
import type { Word } from "@/lib/transcript/types";

/**
 * مرحلة التفريغ.
 *
 * كل محرّك متاح يفرّغ كل المقاطع الفرعية، ثم يُدمج مخرَج كل محرّك على
 * حدة، ثم يُقارن المخرجان. المقارنة هي الناتج الأثمن: ما اتفقا عليه
 * لا يُمسّ، وما اختلفا فيه هو ما تحكم فيه المراجعة (§2.1).
 *
 * **مستأنفة:** تفريغ كل مقطع فرعي يُحفظ فور إنجازه. فإن نفدت الحصة في
 * منتصف ساعة صوت، أُجّلت المهمة، ولمّا عادت تخطّت ما أُنجز. بلا هذا
 * يُعاد تفريغ ما فُرّغ — وهو إنفاق لحصة نادرة على عمل مكرَّر.
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
    throw new ConfigError(
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

  const done = await loadFinishedSegments(itemId);
  let deferral: QuotaExhaustedError | null = null;

  for (const plan of plans) {
    const missing = engines.filter((e) => !done.has(`${plan.id}|${e.name}`));
    if (missing.length === 0) continue; // أُنجز في تشغيل سابق

    const chunkPath = join(item.mediaPath, "..", `seg-${plan.index}.wav`);
    await extractSegment(item.mediaPath, chunkPath, plan.startMs, plan.endMs);
    const audio = await readAndDiscard(chunkPath);
    const audioSeconds = (plan.endMs - plan.startMs) / 1000;

    for (const engine of missing) {
      try {
        const result = await runProvider(
          engine,
          {
            audio,
            filename: `seg-${plan.index}.wav`,
            audioSeconds,
            glossary: glossaryTerms,
            languageHint: item.languageHint ?? "ar",
            offsetMs: plan.startMs,
          },
          itemId,
        );

        await db
          .insert(transcripts)
          .values({
            itemId,
            segmentId: plan.id,
            stage: "transcribe",
            engine: engine.name,
            model: engine.model,
            text: result.text,
            wordsJson: result.words,
            avgConfidence: result.avgConfidence ?? null,
          })
          .onConflictDoNothing();

        done.add(`${plan.id}|${engine.name}`);
      } catch (err) {
        // نفاد الحصة ليس فشلًا: نواصل بما بقي من محرّكات، ونؤجّل في
        // النهاية إن بقي مقطع بلا تفريغ من أي محرّك.
        if (err instanceof QuotaExhaustedError) {
          deferral ??= err;
          continue;
        }
        console.error(`[transcribe] ${engine.name} أخفق في المقطع ${plan.index}:`, err);
      }
    }
  }

  const uncovered = plans.filter(
    (plan) => !engines.some((e) => done.has(`${plan.id}|${e.name}`)),
  );

  if (uncovered.length > 0) {
    if (deferral) {
      // العامل يعيد الجدولة بلا احتساب محاولة فاشلة، وما أُنجز باقٍ.
      await db
        .update(items)
        .set({
          status: "queued",
          errorMessage: `${deferral.message} — بقي ${uncovered.length} مقطعًا`,
        })
        .where(eq(items.id, itemId));
      throw deferral;
    }
    throw new Error(
      `تعذّر تفريغ ${uncovered.length} مقطعًا فرعيًا بأي محرّك متاح.`,
    );
  }

  await finalize(itemId, plans, engines);
  await enqueueReview(itemId);
}

/** مفاتيح «مقطع فرعي + محرّك» التي أُنجزت سلفًا. */
async function loadFinishedSegments(itemId: string): Promise<Set<string>> {
  const rows = await db
    .select({ segmentId: transcripts.segmentId, engine: transcripts.engine })
    .from(transcripts)
    .where(
      and(
        eq(transcripts.itemId, itemId),
        eq(transcripts.stage, "transcribe"),
        isNotNull(transcripts.segmentId),
      ),
    );
  return new Set(rows.map((r) => `${r.segmentId}|${r.engine}`));
}

/** الدمج والمقارنة بعد اكتمال كل المقاطع الفرعية. */
async function finalize(
  itemId: string,
  plans: { id: string; index: number; startMs: number; endMs: number; overlapMs: number }[],
  engines: readonly TranscriptionProvider[],
): Promise<void> {
  const parts = await db
    .select()
    .from(transcripts)
    .where(
      and(
        eq(transcripts.itemId, itemId),
        eq(transcripts.stage, "transcribe"),
        isNotNull(transcripts.segmentId),
      ),
    );

  const planById = new Map(plans.map((p) => [p.id, p]));
  const byEngine = new Map<string, SegmentTranscript[]>();

  for (const part of parts) {
    const plan = planById.get(part.segmentId!);
    if (!plan) continue;
    const list = byEngine.get(part.engine) ?? [];
    list.push({
      plan: {
        index: plan.index,
        startMs: plan.startMs,
        endMs: plan.endMs,
        overlapMs: plan.overlapMs,
      },
      words: (part.wordsJson ?? []) as Word[],
    });
    byEngine.set(part.engine, list);
  }

  // إعادة التشغيل قد تجد نسخة مدموجة قديمة؛ نمسحها ونكتب الحالية.
  await db
    .delete(transcripts)
    .where(
      and(
        eq(transcripts.itemId, itemId),
        eq(transcripts.stage, "transcribe"),
        isNull(transcripts.segmentId),
      ),
    );

  const merged = new Map<string, Word[]>();
  for (const [engineName, list] of byEngine) merged.set(engineName, mergeSegments(list));

  // المتحدثون: من المحرّك الذي يميّزهم (Gemini) إلى غيره، بمحاذاة النصّين.
  const labelled = [...merged.values()].find((w) => w.some((x) => x.speaker));
  if (labelled) {
    for (const [name, words] of merged) {
      if (words !== labelled) merged.set(name, transferSpeakers(words, labelled));
    }
  }

  const [owner] = await db
    .select({ speakers: projects.speakers })
    .from(items)
    .innerJoin(projects, eq(projects.id, items.projectId))
    .where(eq(items.id, itemId))
    .limit(1);

  for (const [engineName, words] of merged) {
    const engine = engines.find((e) => e.name === engineName);
    const layout = layoutParagraphs(words);
    await db.insert(transcripts).values({
      itemId,
      segmentId: null,
      stage: "transcribe",
      engine: engineName,
      model: engine?.model ?? "unknown",
      text: composeText(
        layout.paragraphs.map((p) => p.text),
        layout,
        owner?.speakers ?? [],
      ),
      wordsJson: words,
      avgConfidence: averageConfidence(words),
    });
  }

  // المرجع هو أول محرّك نجح، بترتيب الأفضلية لا بترتيب الوصول.
  const primaryName = engines.map((e) => e.name).find((n) => merged.has(n));
  if (!primaryName) throw new Error("لم ينجح أي محرّك.");

  const primary = merged.get(primaryName)!;
  const secondaryName = [...merged.keys()].find((n) => n !== primaryName);
  const secondary = secondaryName ? merged.get(secondaryName)! : null;

  const spans = secondary ? diffTranscripts(primary, secondary) : [];

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
      difficulty: computeDifficulty(primary, spans.length, secondary !== null),
      status: "reviewing_1",
      currentStage: "review",
      errorMessage: null,
    })
    .where(eq(items.id, itemId));
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
