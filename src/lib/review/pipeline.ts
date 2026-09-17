import type { DiffSpan } from "@/lib/transcript/diff";
import type { Word } from "@/lib/transcript/types";
import { applyEdits, toParagraphs } from "./apply";
import { buildEvidence } from "./evidence";
import { proposeEdits, type TranscriptionMode } from "./stage2";
import { applyVerdicts, auditEdits, type EditVerdict } from "./stage3";
import type { EvidenceSpan, ProposedEdit, RejectedEdit } from "./types";

/**
 * المرحلتان الثانية والثالثة معًا.
 *
 * الترتيب: أدلة ← اقتراح ← حارس ← تدقيق ← حارس ← نصّ نهائي.
 * الحارس (`applyEdits`) يعمل مرتين عمدًا: مرة على ما اقترحته المرحلة
 * الثانية، ومرة على ما أقرّته الثالثة — فالثالثة قد تستبدل بديلًا
 * يخالف القواعد بدوره.
 */

export interface ReviewInput {
  text: string;
  words: readonly Word[];
  disagreements: readonly DiffSpan[];
  glossary: readonly string[];
  mode: TranscriptionMode;
}

export interface ReviewOutput {
  /** نصّ المرحلة الثانية */
  reviewedText: string;
  /** نصّ المرحلة الثالثة — المعتمد */
  auditedText: string;
  evidence: EvidenceSpan[];
  proposed: ProposedEdit[];
  rejectedByGuard: RejectedEdit[];
  verdicts: EditVerdict[];
  finalEdits: ProposedEdit[];
}

export async function reviewTranscript(input: ReviewInput): Promise<ReviewOutput> {
  const paragraphs = toParagraphs(input.text);

  const evidence = buildEvidence({
    paragraphs,
    words: input.words,
    disagreements: input.disagreements,
  });

  const proposed = await proposeEdits({
    paragraphs,
    evidence,
    glossary: input.glossary,
    mode: input.mode,
  });

  const guardOptions = { glossary: input.glossary, evidence };
  const stage2 = applyEdits(paragraphs, proposed, guardOptions);

  // التدقيق يحكم على ما نجا من الحارس وحده؛ الحكم على تعديل مرفوض
  // سلفًا إنفاقٌ للحصة بلا أثر.
  const verdicts = await auditEdits({ paragraphs, edits: stage2.applied });
  const finalEdits = applyVerdicts(stage2.applied, verdicts);

  const stage3 = applyEdits(paragraphs, finalEdits, guardOptions);

  return {
    reviewedText: stage2.text,
    auditedText: stage3.text,
    evidence,
    proposed,
    rejectedByGuard: [...stage2.rejected, ...stage3.rejected],
    verdicts,
    finalEdits: stage3.applied,
  };
}

/**
 * المواضع التي بقيت مشكوكًا فيها بعد المرحلتين — تُعرض للمستخدم
 * في محرّر الاعتماد مع توقيتها ليصل إلى اللحظة بالضبط (§5 المرحلة 3).
 */
export function unresolvedSpans(output: ReviewOutput): EvidenceSpan[] {
  const settled = new Set(output.finalEdits.map((e) => `${e.para}|${e.from}`));
  return output.evidence.filter((span) => !settled.has(`${span.para}|${span.text}`));
}
