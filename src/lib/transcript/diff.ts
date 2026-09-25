import { normalizeForCompare } from "@/lib/arabic";
import type { Word } from "./types";

/**
 * مخطط الاختلاف بين محرّكَي تفريغ.
 *
 * هذا قلب المشروع: المراجعة لا تُصحّح إلا ما لديها دليل عليه (§2.1)،
 * والاختلاف بين محرّكين مستقلّين أقوى دليل متاح مجانًا. ما اتفق عليه
 * المحرّكان يُترك وشأنه؛ وما اختلفا فيه وحده يُعرض على النموذج ليحكم.
 *
 * المحاذاة تقصّ الأطراف المتطابقة أولًا — وهي الغالبة — ثم تقسّم ما
 * تبقّى عند مراسٍ مشتركة، فلا تُبنى مصفوفة كبيرة إلا لمناطق الخلاف
 * الصغيرة فعلًا.
 */

export interface DiffSpan {
  /** موضع البداية في كلمات المحرّك الأول */
  aStart: number;
  aEnd: number;
  /** الموضع المقابل في كلمات المحرّك الثاني */
  bStart: number;
  bEnd: number;
  /** نصّ كل محرّك في هذا الموضع */
  a: string;
  b: string;
  startMs: number;
  endMs: number;
}

/** أقصى حجم نسمح فيه بالمحاذاة الدقيقة؛ ما زاد يُقسّم بمرساة. */
const DP_LIMIT = 400;
/** طول المرساة المستعملة في التقسيم. */
const ANCHOR = 5;
const MAX_DEPTH = 24;

export function diffTranscripts(a: readonly Word[], b: readonly Word[]): DiffSpan[] {
  const ta = a.map((w) => normalizeForCompare(w.text));
  const tb = b.map((w) => normalizeForCompare(w.text));

  const raw: RawSpan[] = [];
  walk(ta, tb, 0, a.length, 0, b.length, 0, raw);
  return raw.map((span) => materialize(span, a, b));
}

interface RawSpan {
  aStart: number;
  aEnd: number;
  bStart: number;
  bEnd: number;
}

function walk(
  ta: readonly string[],
  tb: readonly string[],
  aLo: number,
  aHi: number,
  bLo: number,
  bHi: number,
  depth: number,
  out: RawSpan[],
): void {
  // قصّ البادئة المتطابقة
  while (aLo < aHi && bLo < bHi && ta[aLo] === tb[bLo]) {
    aLo++;
    bLo++;
  }
  // قصّ اللاحقة المتطابقة
  while (aHi > aLo && bHi > bLo && ta[aHi - 1] === tb[bHi - 1]) {
    aHi--;
    bHi--;
  }

  if (aLo === aHi && bLo === bHi) return; // متطابقان تمامًا

  // أحد الطرفين فارغ: حذف أو إضافة كاملة
  if (aLo === aHi || bLo === bHi) {
    out.push({ aStart: aLo, aEnd: aHi, bStart: bLo, bEnd: bHi });
    return;
  }

  const aLen = aHi - aLo;
  const bLen = bHi - bLo;

  if (aLen <= DP_LIMIT && bLen <= DP_LIMIT) {
    dpAlign(ta, tb, aLo, aHi, bLo, bHi, out);
    return;
  }

  if (depth >= MAX_DEPTH) {
    out.push({ aStart: aLo, aEnd: aHi, bStart: bLo, bEnd: bHi });
    return;
  }

  const split = findAnchor(ta, tb, aLo, aHi, bLo, bHi);
  if (!split) {
    out.push({ aStart: aLo, aEnd: aHi, bStart: bLo, bEnd: bHi });
    return;
  }

  walk(ta, tb, aLo, split.aAt, bLo, split.bAt, depth + 1, out);
  walk(ta, tb, split.aAt + ANCHOR, aHi, split.bAt + ANCHOR, bHi, depth + 1, out);
}

/**
 * مرساة للتقسيم: تتابع من `ANCHOR` كلمة قرب منتصف المدى الأول نجده
 * في المدى الثاني. البحث يبدأ من المنتصف ويتوسّع، فالقسمة تميل للتوازن.
 */
function findAnchor(
  ta: readonly string[],
  tb: readonly string[],
  aLo: number,
  aHi: number,
  bLo: number,
  bHi: number,
): { aAt: number; bAt: number } | null {
  const mid = Math.floor((aLo + aHi) / 2);
  const reach = Math.floor((aHi - aLo) / 2);

  for (let off = 0; off <= reach; off++) {
    for (const aAt of off === 0 ? [mid] : [mid - off, mid + off]) {
      if (aAt < aLo || aAt + ANCHOR > aHi) continue;
      const needle = ta.slice(aAt, aAt + ANCHOR);
      if (needle.some((t) => t === "")) continue;

      const bAt = indexOfRun(tb, needle, bLo, bHi);
      if (bAt !== -1) return { aAt, bAt };
    }
  }
  return null;
}

function indexOfRun(
  haystack: readonly string[],
  needle: readonly string[],
  lo: number,
  hi: number,
): number {
  outer: for (let i = lo; i + needle.length <= hi; i++) {
    for (let k = 0; k < needle.length; k++) {
      if (haystack[i + k] !== needle[k]) continue outer;
    }
    return i;
  }
  return -1;
}

/** محاذاة دقيقة لمنطقة صغيرة، وإخراج مقاطع الاختلاف المتصلة منها. */
function dpAlign(
  ta: readonly string[],
  tb: readonly string[],
  aLo: number,
  aHi: number,
  bLo: number,
  bHi: number,
  out: RawSpan[],
): void {
  const n = aHi - aLo;
  const m = bHi - bLo;

  // طول أطول سلسلة مشتركة — مصفوفة كاملة، والمنطقة محدودة بـ DP_LIMIT.
  const lcs: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] =
        ta[aLo + i] === tb[bLo + j]
          ? lcs[i + 1]![j + 1]! + 1
          : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }

  // تتبّع المسار، وتجميع الخطوات غير المتطابقة في مقاطع متصلة.
  let i = 0;
  let j = 0;
  let open: RawSpan | null = null;

  const close = () => {
    if (open) {
      out.push(open);
      open = null;
    }
  };

  while (i < n && j < m) {
    if (ta[aLo + i] === tb[bLo + j]) {
      close();
      i++;
      j++;
    } else {
      const advanceA = lcs[i + 1]![j]! >= lcs[i]![j + 1]!;
      open ??= { aStart: aLo + i, aEnd: aLo + i, bStart: bLo + j, bEnd: bLo + j };
      if (advanceA) open.aEnd = aLo + ++i;
      else open.bEnd = bLo + ++j;
    }
  }

  if (i < n || j < m) {
    open ??= { aStart: aLo + i, aEnd: aLo + i, bStart: bLo + j, bEnd: bLo + j };
    open.aEnd = aHi;
    open.bEnd = bHi;
  }
  close();
}

function materialize(
  span: RawSpan,
  a: readonly Word[],
  b: readonly Word[],
): DiffSpan {
  const aWords = a.slice(span.aStart, span.aEnd);
  const bWords = b.slice(span.bStart, span.bEnd);

  // التوقيت يُؤخذ من المحرّك الأول لأنه صاحب التوقيتات الموثوقة.
  // إن كان موضعه فارغًا (إضافة من الثاني) نستعمل حدود ما حوله.
  const startMs =
    aWords[0]?.startMs ?? a[span.aStart - 1]?.endMs ?? bWords[0]?.startMs ?? 0;
  const endMs =
    aWords[aWords.length - 1]?.endMs ??
    a[span.aEnd]?.startMs ??
    bWords[bWords.length - 1]?.endMs ??
    startMs;

  return {
    aStart: span.aStart,
    aEnd: span.aEnd,
    bStart: span.bStart,
    bEnd: span.bEnd,
    a: aWords.map((w) => w.text).join(" "),
    b: bWords.map((w) => w.text).join(" "),
    startMs,
    endMs,
  };
}

/**
 * نسبة الاختلاف بين المحرّكين — أحد مكوّني درجة الصعوبة (§5).
 * الصعوبة العالية توسّع نطاق فحص المرحلة الثالثة.
 */
export function disagreementRate(
  spans: readonly DiffSpan[],
  totalWords: number,
): number {
  if (totalWords === 0) return 0;
  const differing = spans.reduce((sum, s) => sum + Math.max(1, s.aEnd - s.aStart), 0);
  return Math.min(1, differing / totalWords);
}
