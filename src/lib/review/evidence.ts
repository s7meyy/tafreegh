import { normalizeForCompare } from "@/lib/arabic";
import { sameNumber } from "@/lib/arabic-numbers";
import type { DiffSpan } from "@/lib/transcript/diff";
import type { WordPosition } from "@/lib/transcript/layout";
import type { Word } from "@/lib/transcript/types";
import type { EvidenceSpan, Severity } from "./types";

/**
 * بناء مواضع الأدلة.
 *
 * دليلان مجانيان: كلمة قال المحرّك إنه غير واثق منها، وموضع اختلف فيه
 * المحرّكان. ما عداهما لا يُعرض على المراجعة أصلًا (§2.1) — وما لا
 * يُعرض لا يُعدَّل، بحكم `applyEdits`.
 *
 * كل دليل مربوط بموضعه في نصّ فقرته، مأخوذًا من موضع كلماته — لا
 * بالبحث عن نصّه. البحث بالنصّ يصيب أول تكرار للكلمة، وفي العربية
 * تتكرر «الله» و«من» و«في» في كل فقرة.
 */

/** دون هذه الثقة تُعدّ الكلمة مشكوكًا فيها. */
export const CONFIDENCE_FLOOR = 0.6;
/** دون هذه تُعدّ الكلمة شديدة الشك. */
const CONFIDENCE_LOW = 0.45;

export interface BuildEvidenceInput {
  paragraphs: readonly string[];
  /** كلمات المحرّك المرجع، بترتيب النصّ */
  words: readonly Word[];
  /** موضع كل كلمة في الفقرات؛ `null` لكلمة لم يعد لها موضع (حسمها المسرد) */
  positions: readonly (WordPosition | null)[];
  /** مواضع اختلاف المحرّكين، بفهارس كلمات المرجع */
  disagreements?: readonly DiffSpan[];
  confidenceFloor?: number;
}

export function buildEvidence(input: BuildEvidenceInput): EvidenceSpan[] {
  const floor = input.confidenceFloor ?? CONFIDENCE_FLOOR;
  const spans: EvidenceSpan[] = [];
  /** فهارس الكلمات التي غطّاها دليل اختلاف — فلا تُعرض مرتين */
  const covered = new Set<number>();

  const range = (from: number, to: number) => {
    let first: WordPosition | null = null;
    let last: WordPosition | null = null;
    for (let i = from; i < to; i++) {
      const p = input.positions[i];
      // كلمة حسمها المسرد داخل الموضع: الموضع كله محسوم أو ملتبس، فبديل
      // المحرّك الآخر يشمل المصطلح ولا يصلح لما بقي منه.
      if (!p) return null;
      if (first && p.para !== first.para) break; // لا يعبر الدليل حدّ فقرة
      first ??= p;
      last = p;
    }
    return first && last ? { para: first.para, start: first.start, end: last.end } : null;
  };

  for (const diff of input.disagreements ?? []) {
    // الإضافة من المحرّك الثاني لا نصّ لها في المرجع، فلا موضع لها.
    if (diff.aEnd <= diff.aStart) continue;
    // «عشرين» و«20»: كتابتان لعدد واحد، لا خلاف في السماع.
    if (diff.b && sameNumber(diff.a, diff.b)) continue;
    // «عبد الله» و«عبدالله»: فصلٌ ووصل، لا خلاف في السماع.
    if (squash(diff.a) === squash(diff.b)) continue;

    const where = range(diff.aStart, diff.aEnd);
    if (!where) continue;

    const weakWords: string[] = [];
    for (let i = diff.aStart; i < diff.aEnd; i++) {
      covered.add(i);
      const w = input.words[i];
      if (w?.confidence !== undefined && w.confidence < floor) {
        weakWords.push(...normalizeForCompare(w.text).split(" ").filter(Boolean));
      }
    }
    const weak = weakWords.length > 0;

    const omitted = !diff.b.trim();
    const text = input.paragraphs[where.para - 1]!.slice(where.start, where.end);
    const severity: Severity = weak ? "high" : omitted ? "low" : "medium";

    spans.push({
      id: 0,
      para: where.para,
      offset: where.start,
      text,
      kind: "engine_disagreement",
      alternative: diff.b,
      suggestion: suggest(text, diff.b, input.words.slice(diff.aStart, diff.aEnd), floor),
      lowConfidence: weak,
      weak: weakWords,
      severity,
      startMs: diff.startMs,
      endMs: diff.endMs,
    });
  }

  input.words.forEach((word, i) => {
    if (covered.has(i)) return;
    if (word.confidence === undefined || word.confidence >= floor) return;
    const where = range(i, i + 1);
    if (!where) return;
    spans.push({
      id: 0,
      para: where.para,
      offset: where.start,
      text: input.paragraphs[where.para - 1]!.slice(where.start, where.end),
      kind: "low_confidence",
      lowConfidence: true,
      weak: normalizeForCompare(word.text).split(" ").filter(Boolean),
      severity: word.confidence < CONFIDENCE_LOW ? "medium" : "low",
      startMs: word.startMs,
      endMs: word.endMs,
    });
  });

  // بترتيب ورودها في النصّ — هكذا تُعرض على النموذج وعلى المستخدم.
  spans.sort((a, b) => a.para - b.para || a.offset - b.offset);
  spans.forEach((s, i) => (s.id = i + 1));
  return spans;
}

/** نقل مواضع الكلمات عبر استبدالات المسرد. */
export function remapPositions(
  positions: readonly (WordPosition | null)[],
  map: (para: number, start: number, end: number) => { start: number; end: number } | null,
): (WordPosition | null)[] {
  return positions.map((p) => {
    if (!p) return null;
    const moved = map(p.para, p.start, p.end);
    return moved ? { para: p.para, ...moved } : null;
  });
}

/**
 * عرض الأدلة على النموذج: موجز، وفي كلٍّ سياقه القريب — فالكلمة
 * المكررة في الفقرة لا تُعرف بنصّها وحده.
 */
export function formatEvidence(
  spans: readonly EvidenceSpan[],
  paragraphs: readonly string[] = [],
): string {
  if (spans.length === 0) return "لا مواضع مشكوك فيها.";

  return spans
    .map((span) => {
      const where = `[${span.para}]`;
      const context = contextOf(paragraphs[span.para - 1], span);
      const tail = context ? ` في: «${context}»` : "";
      if (span.kind === "engine_disagreement") {
        return `${where} «${span.text}»${tail} — والمحرّك الآخر سمعها: «${span.alternative || "(لا شيء)"}»`;
      }
      return `${where} «${span.text}»${tail} — ثقة المحرّك فيها منخفضة`;
    })
    .join("\n");
}

function contextOf(paragraph: string | undefined, span: EvidenceSpan): string {
  if (!paragraph) return "";
  const before = paragraph.slice(0, span.offset).split(/\s+/).filter(Boolean).slice(-3);
  const after = paragraph
    .slice(span.offset + span.text.length)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3);
  return [...before, `⟦${span.text}⟧`, ...after].join(" ");
}

function squash(text: string): string {
  return normalizeForCompare(text).replace(/\s+/g, "");
}

/**
 * البديل المقترح للمستخدم في موضع اختلاف.
 *
 * بديل المحرّك الآخر كما هو يصلح حين يقابل الموضع كلمةً بكلمة. أما
 * إن كان أقصر — أسقط المحرّك الآخر كلمة — فاستبداله يحذف كلامًا لم
 * يُشكّ فيه. فنضع البديل مكان الكلمات المشكوك فيها وحدها ونُبقي
 * جاراتها، وإن تفرّقت المشكوك فيها فلا اقتراح.
 */
function suggest(
  text: string,
  alternative: string,
  words: readonly Word[],
  floor: number,
): string | undefined {
  const alt = alternative.trim();
  if (!alt) return undefined;
  const tokens = text.split(/\s+/).filter(Boolean);
  const altCount = alt.split(/\s+/).length;
  if (altCount >= tokens.length || tokens.length !== words.length) {
    return altCount >= tokens.length ? alt : undefined;
  }

  const weak = words.map((w) => w.confidence !== undefined && w.confidence < floor);
  const first = weak.indexOf(true);
  const last = weak.lastIndexOf(true);
  if (first === -1 || weak.slice(first, last + 1).includes(false)) return undefined;

  return [...tokens.slice(0, first), alt, ...tokens.slice(last + 1)].join(" ");
}
