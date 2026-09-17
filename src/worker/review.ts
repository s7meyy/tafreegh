import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, edits, glossary, items, projects, transcripts } from "@/db/schema";
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

  if (!isReviewConfigured()) {
    throw new Error("لا مفتاح GEMINI_API_KEY — المراجعة تحتاجه.");
  }

  const produced = await db
    .select()
    .from(transcripts)
    .where(and(eq(transcripts.itemId, itemId), eq(transcripts.stage, "transcribe")))
    .orderBy(desc(transcripts.avgConfidence));

  if (produced.length === 0) {
    throw new Error("لا تفريغ لهذا المقطع — شغّل مرحلة التفريغ أولًا.");
  }

  // المرجع هو صاحب أعلى ثقة؛ درجات الثقة تأتي من Groq وحده، فهو
  // المرجع عمليًا ما دام قد نجح.
  const primary = produced[0]!;
  const secondary = produced.find((t) => t.engine !== primary.engine);

  const primaryWords = (primary.wordsJson ?? []) as Word[];
  const disagreements = secondary
    ? diffTranscripts(primaryWords, (secondary.wordsJson ?? []) as Word[])
    : [];

  const terms = await db
    .select({ term: glossary.term })
    .from(glossary)
    .where(eq(glossary.projectId, project.id));

  await db
    .update(items)
    .set({ status: "reviewing_1", currentStage: "review", errorMessage: null })
    .where(eq(items.id, itemId));

  const output = await reviewTranscript({
    text: primary.text,
    words: primaryWords,
    disagreements,
    glossary: terms.map((t) => t.term),
    mode: project.transcriptionMode,
  });

  await db
    .update(items)
    .set({ status: "reviewing_2", currentStage: "audit" })
    .where(eq(items.id, itemId));

  await db.insert(transcripts).values([
    {
      itemId,
      stage: "review",
      engine: "gemini",
      model: "review",
      text: output.reviewedText,
      wordsJson: null,
      avgConfidence: null,
    },
    {
      itemId,
      stage: "audit",
      engine: "gemini",
      model: "audit",
      text: output.auditedText,
      wordsJson: null,
      avgConfidence: null,
    },
  ]);

  // سجل التعديلات مع حكم التدقيق على كل واحد — مادة تبويب «التعديلات».
  if (output.proposed.length > 0) {
    const kept = new Set(output.finalEdits.map((e) => `${e.para}|${e.from}`));
    await db.insert(edits).values(
      output.proposed.map((e) => ({
        itemId,
        fromStage: "review" as const,
        paragraph: e.para,
        before: e.from,
        after: e.to,
        reason: e.reason,
        confidence: e.confidence ?? null,
        verdict: kept.has(`${e.para}|${e.from}`)
          ? ("accepted" as const)
          : ("rejected" as const),
      })),
    );
  }

  const unresolved = unresolvedSpans(output);

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
