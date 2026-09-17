import type { SegmentPlan } from "@/lib/transcript/types";

/**
 * خطة التقطيع.
 *
 * التقطيع كل ‏10 دقائق بالضبط يقطع الجملة في نصفها، فيفقد المحرّك
 * السياق ويخترع لها نهاية. لذلك نقطع **عند الصمت** (§2.3): نختار من
 * فترات الصمت المرشّحة أقربها إلى الطول المستهدف، ونترك تداخلًا
 * يلتحم عنده الدمج لاحقًا.
 *
 * دالة خالصة: تأخذ فترات الصمت والمدة وتعطي الخطة — فتُختبر بلا صوت.
 */

export interface SilenceGap {
  startMs: number;
  endMs: number;
}

export interface PlanOptions {
  /** الطول المفضّل للمقطع الفرعي */
  targetMs?: number;
  /** الحدّ الأقصى؛ إن لم نجد صمتًا قبله قطعنا قسرًا */
  maxMs?: number;
  /** أقصر مقطع مقبول — يمنع شظايا لا معنى لها */
  minMs?: number;
  /** التداخل بين المقاطع المتجاورة */
  overlapMs?: number;
}

const DEFAULTS: Required<PlanOptions> = {
  targetMs: 8 * 60_000,
  maxMs: 10 * 60_000,
  minMs: 30_000,
  overlapMs: 15_000,
};

export function planSegments(
  durationMs: number,
  silences: readonly SilenceGap[],
  options: PlanOptions = {},
): SegmentPlan[] {
  const o = { ...DEFAULTS, ...options };
  if (durationMs <= 0) return [];

  // مقطع قصير لا يُقطَّع أصلًا.
  if (durationMs <= o.maxMs) {
    return [{ index: 0, startMs: 0, endMs: durationMs, overlapMs: 0 }];
  }

  // نقاط القطع المرشّحة: منتصف كل فترة صمت، مرتّبة.
  const candidates = silences
    .map((s) => Math.round((s.startMs + s.endMs) / 2))
    .filter((ms) => ms > 0 && ms < durationMs)
    .sort((a, b) => a - b);

  const plans: SegmentPlan[] = [];
  let cursor = 0;
  let index = 0;

  while (cursor < durationMs) {
    const remaining = durationMs - cursor;
    if (remaining <= o.maxMs) {
      plans.push(makePlan(index, cursor, durationMs, o.overlapMs, plans.length > 0));
      break;
    }

    const cut =
      pickCut(candidates, cursor + o.minMs, cursor + o.targetMs, cursor + o.maxMs) ??
      cursor + o.targetMs; // لا صمت في المدى — قطع قسري

    plans.push(makePlan(index, cursor, cut, o.overlapMs, plans.length > 0));
    cursor = cut;
    index++;
  }

  return plans;
}

/** أقرب مرشّح إلى الهدف داخل [lo, hi]. */
function pickCut(
  candidates: readonly number[],
  lo: number,
  target: number,
  hi: number,
): number | null {
  let best: number | null = null;
  let bestDistance = Infinity;

  for (const c of candidates) {
    if (c < lo) continue;
    if (c > hi) break;
    const distance = Math.abs(c - target);
    if (distance < bestDistance) {
      best = c;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * المقطع يبدأ قبل حدّه بمقدار التداخل ليُلحم نصيًّا لاحقًا.
 * `startMs` هو البداية الفعلية للاستخراج، و`overlapMs` يخبر الدامج
 * كم من أوله مكرَّر.
 */
function makePlan(
  index: number,
  from: number,
  to: number,
  overlapMs: number,
  hasPrevious: boolean,
): SegmentPlan {
  const overlap = hasPrevious ? Math.min(overlapMs, from) : 0;
  return {
    index,
    startMs: from - overlap,
    endMs: to,
    overlapMs: overlap,
  };
}
