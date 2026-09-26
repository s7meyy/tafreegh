import type { DiffSpan } from "@/lib/transcript/diff";
import type { WordPosition } from "@/lib/transcript/layout";
import type { Word } from "@/lib/transcript/types";
import { applyEdits } from "./apply";
import { buildEvidence } from "./evidence";
import { proposeEdits, type TranscriptionMode } from "./stage2";
import { applyVerdicts, auditEdits, type EditVerdict } from "./stage3";
import type { AppliedEdit, EvidenceSpan, ProposedEdit, RejectedEdit } from "./types";

/**
 * المرحلتان الثانية والثالثة معًا.
 *
 * الترتيب: أدلة ← اقتراح ← حارس ← تدقيق ← حارس ← نصّ نهائي.
 * الحارس (`applyEdits`) يعمل مرتين عمدًا: مرة على ما اقترحته المرحلة
 * الثانية، ومرة على ما أقرّته الثالثة — فالثالثة قد تستبدل بديلًا
 * يخالف القواعد بدوره.
 */

export interface ReviewInput {
  /** الفقرات بعد تصحيح المسرد، بلا أسماء المتحدثين */
  paragraphs: readonly string[];
  words: readonly Word[];
  /** موضع كل كلمة في الفقرات */
  positions: readonly (WordPosition | null)[];
  disagreements: readonly DiffSpan[];
  glossary: readonly string[];
  mode: TranscriptionMode;
  /** وضع «مشروع خاص»: لا يخرج النصّ من الخادم */
  local?: boolean;
}

export interface ReviewOutput {
  /** فقرات المرحلة الثانية */
  reviewed: string[];
  /** فقرات المرحلة الثالثة — المعتمدة */
  audited: string[];
  evidence: EvidenceSpan[];
  proposed: ProposedEdit[];
  rejectedByGuard: RejectedEdit[];
  verdicts: EditVerdict[];
  /** ما طبّقته المرحلة الثانية، بمواضعه — ومنه ما رفضه التدقيق لاحقًا */
  reviewedEdits: AppliedEdit[];
  finalEdits: AppliedEdit[];
}

export async function reviewTranscript(input: ReviewInput): Promise<ReviewOutput> {
  const paragraphs = input.paragraphs;

  const evidence = buildEvidence({
    paragraphs,
    words: input.words,
    positions: input.positions,
    disagreements: input.disagreements,
  });

  const suggested = await proposeEdits({
    paragraphs,
    evidence,
    glossary: input.glossary,
    mode: input.mode,
    local: input.local,
  });
  // رقم لكل تعديل: به يُربط الحكم والرفض بالتعديل نفسه، لا بنصّه —
  // فالتعديل نفسه يتكرّر حين تتكرّر الكلمة الخاطئة.
  const proposed = suggested.map((e, i) => ({ ...e, id: i + 1 }));

  const guardOptions = { glossary: input.glossary, evidence };
  const stage2 = applyEdits(paragraphs, proposed, guardOptions);

  // التدقيق يحكم على ما نجا من الحارس وحده؛ الحكم على تعديل مرفوض
  // سلفًا إنفاقٌ للحصة بلا أثر.
  const verdicts = await auditEdits({
    paragraphs,
    edits: stage2.applied,
    local: input.local,
  });
  const finalEdits = applyVerdicts(stage2.applied, verdicts);

  const stage3 = applyEdits(paragraphs, finalEdits, guardOptions);

  return {
    reviewed: stage2.paragraphs,
    audited: stage3.paragraphs,
    evidence,
    proposed,
    rejectedByGuard: [...stage2.rejected, ...stage3.rejected],
    verdicts,
    reviewedEdits: stage2.applied,
    finalEdits: stage3.applied,
  };
}

/**
 * المواضع التي بقيت مشكوكًا فيها بعد المرحلتين — تُعرض للمستخدم
 * في محرّر الاعتماد مع توقيتها ليصل إلى اللحظة بالضبط (§5 المرحلة 3).
 */
export function unresolvedSpans(output: ReviewOutput): EvidenceSpan[] {
  const settled = new Set(output.finalEdits.flatMap((e) => e.spanIds));
  return output.evidence.filter((span) => !settled.has(span.id));
}
