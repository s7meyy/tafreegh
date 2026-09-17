import { normalizeForCompare } from "@/lib/arabic";
import type { SegmentPlan, Word } from "./types";

/**
 * دمج مقاطع متداخلة في نصّ واحد.
 *
 * القصّ الزمني عند منتصف التداخل يقطع الكلمة أو يكرّرها، لأن المحرّكين
 * لا يضعان حدود الكلمات في اللحظة نفسها. فنقصّ عند **مطابقة نصّية**:
 * نبحث عن أطول تتابع كلمات مشترك بين ذيل ما جمعناه ورأس المقطع التالي،
 * ونلحم عنده. والقصّ الزمني يبقى احتياطًا حين لا نجد مطابقة.
 */

/** أقصر تتابع نقبله مرساةً. أقل من ثلاث كلمات يصادف كثيرًا فيخطئ اللحام. */
const MIN_ANCHOR = 3;

export interface SegmentTranscript {
  plan: SegmentPlan;
  /** كلمات المقطع بتوقيت نسبي لبدايته */
  words: Word[];
}

export function mergeSegments(parts: readonly SegmentTranscript[]): Word[] {
  const ordered = [...parts].sort((a, b) => a.plan.index - b.plan.index);

  let merged: Word[] = [];
  for (const part of ordered) {
    const absolute = part.words.map((w) => ({
      ...w,
      startMs: w.startMs + part.plan.startMs,
      endMs: w.endMs + part.plan.startMs,
    }));

    if (merged.length === 0) {
      merged = absolute;
      continue;
    }
    merged = joinAt(merged, absolute, part.plan);
  }
  return merged;
}

function joinAt(left: Word[], right: Word[], plan: SegmentPlan): Word[] {
  if (right.length === 0) return left;
  if (plan.overlapMs <= 0) return [...left, ...right];

  // منطقة التداخل: من بداية المقطع الجديد إلى نهاية آخر كلمة سابقة.
  const overlapStart = plan.startMs;
  const leftTailFrom = firstIndexEndingAfter(left, overlapStart);
  const rightHeadUntil = lastIndexStartingBefore(right, left[left.length - 1]!.endMs);

  const tail = left.slice(leftTailFrom);
  const head = right.slice(0, rightHeadUntil + 1);

  const anchor = longestCommonRun(tokensOf(tail), tokensOf(head));
  if (anchor && anchor.length >= MIN_ANCHOR) {
    // نحتفظ بكلمات اليسار حتى بداية المرساة، ثم نكمل من اليمين عندها.
    return [...left.slice(0, leftTailFrom + anchor.aStart), ...right.slice(anchor.bStart)];
  }

  // لا مطابقة — نقصّ عند منتصف التداخل. أضعف، لكنه لا يفقد كلامًا.
  const cutMs = overlapStart + plan.overlapMs / 2;
  return [
    ...left.filter((w) => w.endMs <= cutMs),
    ...right.filter((w) => w.startMs > cutMs),
  ];
}

function tokensOf(words: readonly Word[]): string[] {
  return words.map((w) => normalizeForCompare(w.text));
}

function firstIndexEndingAfter(words: readonly Word[], ms: number): number {
  const i = words.findIndex((w) => w.endMs > ms);
  return i === -1 ? words.length : i;
}

function lastIndexStartingBefore(words: readonly Word[], ms: number): number {
  let last = -1;
  for (let i = 0; i < words.length; i++) {
    if (words[i]!.startMs < ms) last = i;
    else break;
  }
  return last;
}

/**
 * أطول تتابع متطابق بين مصفوفتي كلمات (أطول سلسلة فرعية متصلة).
 * المصفوفتان صغيرتان — منطقة التداخل ‏15 ثانية ≈ ‏40 كلمة — فالتكلفة لا تُذكر.
 */
export function longestCommonRun(
  a: readonly string[],
  b: readonly string[],
): { aStart: number; bStart: number; length: number } | null {
  if (a.length === 0 || b.length === 0) return null;

  let best = { aStart: 0, bStart: 0, length: 0 };
  let prev = new Array<number>(b.length + 1).fill(0);
  let curr = new Array<number>(b.length + 1).fill(0);

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] !== "" && a[i - 1] === b[j - 1]) {
        curr[j] = prev[j - 1]! + 1;
        if (curr[j]! > best.length) {
          best = { aStart: i - curr[j]!, bStart: j - curr[j]!, length: curr[j]! };
        }
      } else {
        curr[j] = 0;
      }
    }
    [prev, curr] = [curr, prev];
    curr.fill(0);
  }

  return best.length > 0 ? best : null;
}

/** تجميع الكلمات في نصّ بفواصل مسافة واحدة. */
export function wordsToText(words: readonly Word[]): string {
  return words
    .map((w) => w.text.trim())
    .filter(Boolean)
    .join(" ");
}
