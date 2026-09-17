import { describe, expect, it } from "vitest";
import { diffTranscripts, disagreementRate } from "./diff";
import type { Word } from "./types";

function words(text: string): Word[] {
  return text.split(" ").map((t, i) => ({
    text: t,
    startMs: i * 500,
    endMs: i * 500 + 400,
  }));
}

describe("diffTranscripts", () => {
  it("لا يُخرج شيئًا حين يتفق المحرّكان", () => {
    const t = words("الحمد لله رب العالمين");
    expect(diffTranscripts(t, t)).toEqual([]);
  });

  it("لا يُخرج شيئًا لاختلاف رسم لا معنى له", () => {
    const a = words("قال إبراهيم هذه المكتبة");
    const b = words("قال ابراهيم هذة المكتبه");
    expect(diffTranscripts(a, b)).toEqual([]);
  });

  it("يرصد إبدال كلمة واحدة ويعطي نصّ كل محرّك", () => {
    const a = words("سافرنا إلى الرياض أمس");
    const b = words("سافرنا إلى جدة أمس");

    const spans = diffTranscripts(a, b);
    expect(spans).toHaveLength(1);
    expect(spans[0]!.a).toBe("الرياض");
    expect(spans[0]!.b).toBe("جدة");
  });

  it("يعطي توقيت موضع الخلاف من المحرّك الأول", () => {
    const a = words("واحد اثنان ثلاثة أربعة");
    const b = words("واحد اثنان خمسة أربعة");

    const [span] = diffTranscripts(a, b);
    expect(span!.startMs).toBe(1000); // الكلمة الثالثة
    expect(span!.endMs).toBe(1400);
  });

  it("يرصد الحذف من المحرّك الثاني", () => {
    const a = words("قال لنا الشيخ كلامًا طويلًا جدًا");
    const b = words("قال لنا الشيخ طويلًا جدًا");

    const spans = diffTranscripts(a, b);
    expect(spans).toHaveLength(1);
    expect(spans[0]!.a).toBe("كلامًا");
    expect(spans[0]!.b).toBe("");
  });

  it("يرصد الإضافة من المحرّك الثاني", () => {
    const a = words("قال لنا الشيخ طويلًا جدًا");
    const b = words("قال لنا الشيخ كلامًا طويلًا جدًا");

    const spans = diffTranscripts(a, b);
    expect(spans).toHaveLength(1);
    expect(spans[0]!.a).toBe("");
    expect(spans[0]!.b).toBe("كلامًا");
  });

  it("يفصل موضعي خلاف متباعدين بدل دمجهما", () => {
    const a = words("واحد اثنان ثلاثة أربعة خمسة ستة سبعة ثمانية");
    const b = words("واحد تسعة ثلاثة أربعة خمسة ستة عشرة ثمانية");

    const spans = diffTranscripts(a, b);
    expect(spans).toHaveLength(2);
    expect(spans[0]!.a).toBe("اثنان");
    expect(spans[1]!.a).toBe("سبعة");
  });

  it("يتعامل مع نص طويل يتجاوز حد المحاذاة الدقيقة", () => {
    const base = Array.from({ length: 1500 }, (_, i) => `كلمة${i}`);
    const a = words(base.join(" "));
    const changed = [...base];
    changed[700] = "مختلفة";
    const b = words(changed.join(" "));

    const spans = diffTranscripts(a, b);
    expect(spans).toHaveLength(1);
    expect(spans[0]!.a).toBe("كلمة700");
    expect(spans[0]!.b).toBe("مختلفة");
  });

  it("يتعامل مع مخرج فارغ من أحد المحرّكين", () => {
    const a = words("كلام موجود");
    const spans = diffTranscripts(a, []);
    expect(spans).toHaveLength(1);
    expect(spans[0]!.a).toBe("كلام موجود");
    expect(spans[0]!.b).toBe("");
  });
});

describe("disagreementRate", () => {
  it("صفر بلا اختلاف", () => {
    expect(disagreementRate([], 100)).toBe(0);
  });

  it("صفر حين لا كلمات أصلًا", () => {
    expect(disagreementRate([], 0)).toBe(0);
  });

  it("ينسب عدد الكلمات المختلف فيها إلى المجموع", () => {
    const a = words("واحد اثنان ثلاثة أربعة خمسة ستة سبعة ثمانية تسعة عشرة");
    const changed = a.map((w, i) => (i === 3 ? { ...w, text: "مختلفة" } : w));
    const spans = diffTranscripts(a, changed);
    expect(disagreementRate(spans, 10)).toBeCloseTo(0.1);
  });
});
