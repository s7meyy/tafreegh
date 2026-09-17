import type { DiffSpan } from "@/lib/transcript/diff";
import type { Word } from "@/lib/transcript/types";
import type { EvidenceSpan } from "./types";

/**
 * بناء مواضع الأدلة.
 *
 * دليلان مجانيان: كلمة قال المحرّك إنه غير واثق منها، وموضع اختلف فيه
 * المحرّكان. ما عداهما لا يُعرض على المراجعة أصلًا (§2.1) — وما لا
 * يُعرض لا يُعدَّل، بحكم `applyEdits`.
 */

/** دون هذه الثقة تُعدّ الكلمة مشكوكًا فيها. */
export const CONFIDENCE_FLOOR = 0.6;

export interface BuildEvidenceInput {
  paragraphs: readonly string[];
  /** كلمات المحرّك المرجع، بترتيب النصّ */
  words: readonly Word[];
  /** مواضع اختلاف المحرّكين */
  disagreements?: readonly DiffSpan[];
  confidenceFloor?: number;
}

export function buildEvidence(input: BuildEvidenceInput): EvidenceSpan[] {
  const floor = input.confidenceFloor ?? CONFIDENCE_FLOOR;
  const locate = paragraphLocator(input.paragraphs);
  const spans: EvidenceSpan[] = [];
  const seen = new Set<string>();

  const push = (span: EvidenceSpan) => {
    // موضع قام عليه الدليلان معًا يُعرض مرة واحدة.
    const key = `${span.para}|${span.text}|${span.kind}`;
    if (seen.has(key)) return;
    seen.add(key);
    spans.push(span);
  };

  for (const word of input.words) {
    if (word.confidence === undefined || word.confidence >= floor) continue;
    const para = locate(word.text);
    if (para) {
      push({
        para,
        text: word.text,
        kind: "low_confidence",
        startMs: word.startMs,
      });
    }
  }

  for (const diff of input.disagreements ?? []) {
    // الإضافة من المحرّك الثاني لا نصّ لها في المرجع، فلا موضع لها.
    if (!diff.a.trim()) continue;
    const para = locate(diff.a);
    if (para) {
      push({
        para,
        text: diff.a,
        kind: "engine_disagreement",
        alternative: diff.b,
        startMs: diff.startMs,
      });
    }
  }

  return spans;
}

/**
 * يحدّد الفقرة التي ورد فيها نصّ ما.
 *
 * يتقدّم عبر الفقرات ولا يرجع: النصّ والكلمات على ترتيب واحد، فالبحث
 * من أول الفقرات لكل كلمة يعطي الفقرة الخطأ عند تكرار الكلمة — وهو
 * كثير في العربية.
 */
function paragraphLocator(
  paragraphs: readonly string[],
): (needle: string) => number | null {
  let cursor = 0;

  return (needle) => {
    const text = needle.trim();
    if (!text) return null;

    for (let i = cursor; i < paragraphs.length; i++) {
      if (paragraphs[i]!.includes(text)) {
        cursor = i;
        return i + 1;
      }
    }
    // لم نجده أمامنا — قد يكون التقدّم سبقه؛ نبحث فيما مضى دون تحريك المؤشر.
    for (let i = 0; i < cursor; i++) {
      if (paragraphs[i]!.includes(text)) return i + 1;
    }
    return null;
  };
}

/** عرض الأدلة على النموذج: نصّ موجز يفهمه ولا يضيّع رموزًا. */
export function formatEvidence(spans: readonly EvidenceSpan[]): string {
  if (spans.length === 0) return "لا مواضع مشكوك فيها.";

  return spans
    .map((span) => {
      const where = `[${span.para}]`;
      if (span.kind === "engine_disagreement") {
        return `${where} «${span.text}» — والمحرّك الآخر سمعها: «${span.alternative || "(لا شيء)"}»`;
      }
      return `${where} «${span.text}» — ثقة المحرّك فيها منخفضة`;
    })
    .join("\n");
}
