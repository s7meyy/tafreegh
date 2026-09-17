import { describe, expect, it } from "vitest";
import { planSegments, type SilenceGap } from "./plan";

const MIN = 60_000;

/** فترات صمت كل دقيقة، طول كل منها ثانية. */
function silencesEveryMinute(count: number): SilenceGap[] {
  return Array.from({ length: count }, (_, i) => ({
    startMs: (i + 1) * MIN,
    endMs: (i + 1) * MIN + 1000,
  }));
}

describe("planSegments", () => {
  it("لا يقطّع مقطعًا أقصر من الحد الأقصى", () => {
    const plans = planSegments(5 * MIN, silencesEveryMinute(4));
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ index: 0, startMs: 0, endMs: 5 * MIN, overlapMs: 0 });
  });

  it("يعيد خطة فارغة لمدة صفرية", () => {
    expect(planSegments(0, [])).toEqual([]);
  });

  it("يقطع عند الصمت الأقرب إلى الطول المستهدف", () => {
    const plans = planSegments(25 * MIN, silencesEveryMinute(24));
    // الهدف 8 دقائق، وفترات الصمت عند الدقائق الصحيحة
    expect(plans[0]!.endMs).toBe(8 * MIN + 500);
  });

  it("يغطّي المدة كاملة بلا فجوات", () => {
    const plans = planSegments(25 * MIN, silencesEveryMinute(24));
    expect(plans[0]!.startMs).toBe(0);
    expect(plans.at(-1)!.endMs).toBe(25 * MIN);

    for (let i = 1; i < plans.length; i++) {
      const prev = plans[i - 1]!;
      const curr = plans[i]!;
      // بداية المقطع تسبق نهاية سابقه بمقدار التداخل بالضبط
      expect(curr.startMs + curr.overlapMs).toBe(prev.endMs);
    }
  });

  it("يترك تداخلًا لكل مقطع عدا الأول", () => {
    const plans = planSegments(25 * MIN, silencesEveryMinute(24));
    expect(plans[0]!.overlapMs).toBe(0);
    for (const plan of plans.slice(1)) expect(plan.overlapMs).toBe(15_000);
  });

  it("يقطع قسرًا عند الطول المستهدف إن لم يجد صمتًا", () => {
    const plans = planSegments(25 * MIN, []);
    expect(plans[0]!.endMs).toBe(8 * MIN);
    expect(plans.at(-1)!.endMs).toBe(25 * MIN);
  });

  it("يتجاهل الصمت الواقع قبل الحد الأدنى للمقطع", () => {
    // صمت وحيد عند الثانية العاشرة فقط — أقصر من minMs
    const plans = planSegments(25 * MIN, [{ startMs: 10_000, endMs: 11_000 }]);
    expect(plans[0]!.endMs).toBe(8 * MIN); // قطع قسري لا عند ذلك الصمت
  });

  it("يحترم الحد الأقصى حتى لو كان أقرب صمت بعده", () => {
    // لا صمت إلا عند الدقيقة 15، والحد الأقصى 10 دقائق
    const plans = planSegments(30 * MIN, [{ startMs: 15 * MIN, endMs: 15 * MIN + 1000 }]);
    expect(plans[0]!.endMs).toBeLessThanOrEqual(10 * MIN);
  });

  it("يقبل ضبط الأطوال", () => {
    const plans = planSegments(10 * MIN, [], {
      targetMs: 2 * MIN,
      maxMs: 3 * MIN,
      overlapMs: 5000,
    });
    expect(plans.length).toBeGreaterThan(3);
    expect(plans[1]!.overlapMs).toBe(5000);
  });

  it("يرقّم المقاطع تصاعديًا بلا فجوة", () => {
    const plans = planSegments(40 * MIN, silencesEveryMinute(39));
    expect(plans.map((p) => p.index)).toEqual(plans.map((_, i) => i));
  });
});
