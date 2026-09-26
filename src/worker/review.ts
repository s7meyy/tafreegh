import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { env } from "@/lib/env";
import { ConfigError } from "@/lib/errors";
import { auditLog, edits, glossary, items, projects, transcripts } from "@/db/schema";
import { composeSegments, composeText, prepareDocument } from "@/lib/review/document";
import { isGenericTitle, suggestTitle } from "@/lib/review/title";
import { applyTurns, inferTurns, remapPosition, type Turn } from "@/lib/review/turns";
import { isReviewConfigured } from "@/lib/review/provider";
import { reviewTranscript, unresolvedSpans } from "@/lib/review/pipeline";
import { diffTranscripts } from "@/lib/transcript/diff";
import type { Word } from "@/lib/transcript/types";

/**
 * مرحلتا المراجعة والتدقيق.
 *
 * تعملان معًا في مهمة واحدة: التدقيق يحتاج مخرَج التصحيح كاملًا، ولا
 * فائدة من تجزئتهما إلى مهمتين تتبادلان الحالة عبر قاعدة البيانات.
 */
export async function reviewItem(itemId: string): Promise<void> {
  const [item] = await db.select().from(items).where(eq(items.id, itemId)).limit(1);
  if (!item) throw new Error(`المقطع ${itemId} غير موجود`);

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, item.projectId))
    .limit(1);
  if (!project) throw new Error("المجلد غير موجود");

  const local = project.profile === "local_only";
  const reviewEngine = env().DEMO_MODE ? "demo" : local ? "ollama" : "gemini";
  if (!isReviewConfigured(local)) {
    throw new ConfigError(
      local
        ? "وضع «مشروع خاص» يحتاج Ollama — اضبط OLLAMA_BASE_URL وشغّله."
        : "لا مفتاح GEMINI_API_KEY — المراجعة تحتاجه.",
    );
  }

  // النسخ المدموجة وحدها: نسخ المقاطع الفرعية (للاستئناف) تغطي جزءًا من
  // التسجيل، ومراجعة إحداها تُخرج نصًّا معتمدًا لنصف المقطع.
  const produced = await db
    .select()
    .from(transcripts)
    .where(
      and(
        eq(transcripts.itemId, itemId),
        eq(transcripts.stage, "transcribe"),
        isNull(transcripts.segmentId),
      ),
    );

  if (produced.length === 0) {
    throw new Error("لا تفريغ لهذا المقطع — شغّل مرحلة التفريغ أولًا.");
  }

  // المرجع هو المحرّك صاحب درجات الثقة والتوقيتات الموثوقة. الترتيب في
  // SQL تنازليًا يضع القيم الفارغة أولًا، فكان يختار المحرّك الذي لا
  // ثقة له أصلًا — فتضيع أدلة «الثقة المنخفضة» وتفسد التوقيتات.
  const ranked = [...produced].sort(
    (a, b) => (b.avgConfidence ?? -1) - (a.avgConfidence ?? -1),
  );
  const primary = ranked[0]!;
  const secondary = ranked.find((t) => t.engine !== primary.engine);

  const primaryWords = (primary.wordsJson ?? []) as Word[];
  const disagreements = secondary
    ? diffTranscripts(primaryWords, (secondary.wordsJson ?? []) as Word[])
    : [];

  const terms = await db
    .select({ term: glossary.term, variants: glossary.variants })
    .from(glossary)
    .where(eq(glossary.projectId, project.id));

  // الفقرات تُبنى من الكلمات لا من النصّ: بها يُعرف موضع كل كلمة،
  // فيقع الدليل والتعديل في موضعهما لا على أول تكرار. والأشكال
  // الخاطئة المعلومة تُصحَّح آليًا قبل النموذج: بلا حصة، وبلا احتمال خطأ.
  const doc = prepareDocument(primaryWords, terms);

  await db
    .update(items)
    .set({ status: "reviewing_1", currentStage: "review", errorMessage: null })
    .where(eq(items.id, itemId));

  const output = await reviewTranscript({
    paragraphs: doc.paragraphs,
    words: primaryWords,
    positions: doc.positions,
    disagreements,
    glossary: terms.map((t) => t.term),
    mode: project.transcriptionMode,
    local,
  });

  await db
    .update(items)
    .set({ status: "reviewing_2", currentStage: "audit" })
    .where(eq(items.id, itemId));

  // المتحدثون: من المحرّك إن ميّزهم، وإلا من النصّ نفسه.
  const hasSpeakers = doc.layout.paragraphs.some((p) => p.speaker);
  const turns = hasSpeakers ? null : await speakerTurns(output.audited, project.speakers, local);
  const labelled = (paragraphs: string[]) =>
    turns
      ? composeSegments(applyTurns(paragraphs, turns).segments, project.speakers)
      : composeText(paragraphs, doc.layout, project.speakers);
  // تقسيم المداخلات يغيّر ترقيم الفقرات؛ المواضع تُنقل إليه.
  const finalSegments = turns ? applyTurns(output.audited, turns).segments : null;
  const where = (para: number, offset = 0) =>
    finalSegments ? remapPosition(finalSegments, para, offset) : { para, offset };

  await suggestTitleFor(item, output.audited, local);

  await db.insert(transcripts).values([
    {
      itemId,
      stage: "review",
      engine: reviewEngine,
      model: "review",
      text: labelled(output.reviewed),
      wordsJson: null,
      avgConfidence: null,
    },
    {
      itemId,
      stage: "audit",
      engine: reviewEngine,
      model: "audit",
      text: labelled(output.audited),
      wordsJson: null,
      avgConfidence: null,
    },
  ]);

  // سجل التعديلات مع حكم التدقيق على كل واحد — مادة تبويب «التعديلات».
  const paragraphStart = (para: number) => doc.layout.paragraphs[para - 1]?.startMs ?? null;

  if (doc.glossaryEdits.length > 0) {
    await db.insert(edits).values(
      doc.glossaryEdits.map((e) => ({
        itemId,
        fromStage: "review" as const,
        paragraph: where(e.para).para,
        before: e.from,
        after: e.to,
        reason: e.reason,
        confidence: 1,
        verdict: "accepted" as const,
        verdictNote: "تصحيح آلي من مسرد المشروع",
        startMs: paragraphStart(e.para),
      })),
    );
  }

  if (output.proposed.length > 0) {
    // كل تعديل مقترح بحكمه ومَن حكم: الحارس (فحص آلي في الكود) أم
    // المدقّق (نموذج). الربط بالرقم لا بالنصّ: التعديل نفسه يتكرّر
    // حين تتكرّر الكلمة، فالربط بالنصّ يخلط أحكامها.
    const kept = new Map(output.finalEdits.map((e) => [e.id, e]));
    const guarded = new Map(output.rejectedByGuard.map((r) => [r.edit.id, r.message]));
    const located = new Map(output.reviewedEdits.map((e) => [e.id, e]));

    await db.insert(edits).values(
      output.proposed.map((e) => {
        const final = kept.get(e.id);
        const guardNote = final ? undefined : guarded.get(e.id);
        const at = (final ?? located.get(e.id))?.at;
        return {
          itemId,
          fromStage: "review" as const,
          paragraph: where(e.para, at).para,
          before: e.from,
          after: final?.to ?? e.to,
          reason: e.reason,
          confidence: e.confidence ?? null,
          verdict: final ? ("accepted" as const) : ("rejected" as const),
          verdictNote: guardNote ? `الحارس: ${guardNote}` : final ? null : "المدقّق",
          startMs: (final ?? located.get(e.id))?.startMs ?? null,
          endMs: (final ?? located.get(e.id))?.endMs ?? null,
        };
      }),
    );
  }

  const unresolved = unresolvedSpans(output).map((span) => ({
    ...span,
    ...where(span.para, span.offset),
  }));

  await db.insert(auditLog).values({
    itemId,
    action: "review",
    actor: "worker",
    detail: {
      evidence: output.evidence.length,
      proposed: output.proposed.length,
      rejectedByGuard: output.rejectedByGuard.length,
      applied: output.finalEdits.length,
      unresolved: unresolved.length,
      // مواضع تحتاج نظر المستخدم، بتوقيتها
      unresolvedSpans: unresolved.slice(0, 100),
    },
  });

  await db
    .update(items)
    .set({ status: "awaiting_approval", currentStage: "export" })
    .where(eq(items.id, itemId));
}

/**
 * مداخلات المتحدثين من النصّ، حين لم يميّزهم المحرّك.
 * إضافة لا شرط: فشلها لا يُفشل المراجعة، والنصّ يبقى بلا أسماء كما كان.
 */
async function speakerTurns(
  paragraphs: string[],
  names: readonly string[],
  local: boolean,
): Promise<Turn[] | null> {
  try {
    const turns = await inferTurns({ paragraphs, names, local });
    const distinct = new Set(turns.map((t) => t.speaker));
    return distinct.size >= 2 ? turns : null;
  } catch (err) {
    console.warn(`[review] تعذّر استنتاج المتحدثين: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

/** العنوان المقترح: يحلّ محلّ الاسم العام آليًا، ويُعرض اقتراحًا على غيره. */
async function suggestTitleFor(
  item: { id: string; title: string; sourceType: string },
  paragraphs: string[],
  local: boolean,
): Promise<void> {
  try {
    const title = await suggestTitle(paragraphs, local);
    if (!title || title === item.title) return;
    // عنوان يوتيوب اختاره صاحبه، فلا يُستبدل وإن بدا عامًا
    const replace = item.sourceType !== "youtube" && isGenericTitle(item.title);
    await db
      .update(items)
      .set(replace ? { title, suggestedTitle: null } : { suggestedTitle: title })
      .where(eq(items.id, item.id));
  } catch (err) {
    console.warn(`[review] تعذّر اقتراح عنوان: ${err instanceof Error ? err.message : err}`);
  }
}
