import { describe, expect, it } from "vitest";
import { layoutParagraphs } from "./layout";
import type { Word } from "./types";

function stream(count: number, opts: { gapAt?: number[]; speakerFrom?: number } = {}): Word[] {
  let t = 0;
  return Array.from({ length: count }, (_, i) => {
    if (opts.gapAt?.includes(i)) t += 3_000;
    const w: Word = { text: `ك${i}`, startMs: t, endMs: t + 300 };
    if (opts.speakerFrom !== undefined) w.speaker = i < opts.speakerFrom ? "1" : "2";
    t += 400;
    return w;
  });
}

describe("layoutParagraphs", () => {
  it("يقسم عند تبدّل المتكلم ولو قصرت الفقرة", () => {
    const { paragraphs } = layoutParagraphs(stream(10, { speakerFrom: 4 }));
    expect(paragraphs.map((p) => p.speaker)).toEqual(["1", "2"]);
    expect(paragraphs[0]!.text.split(" ")).toHaveLength(4);
  });

  it("يقسم عند الوقفة الطويلة إذا بلغت الفقرة حدّها الأدنى", () => {
    const { paragraphs } = layoutParagraphs(stream(60, { gapAt: [5, 30] }));
    // الوقفة بعد خمس كلمات لا تقطع؛ التي بعد ثلاثين تقطع
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[1]!.firstWord).toBe(30);
  });

  it("لا تتجاوز فقرة الحدّ الأقصى", () => {
    const { paragraphs } = layoutParagraphs(stream(400));
    expect(Math.max(...paragraphs.map((p) => p.text.split(" ").length))).toBeLessThanOrEqual(160);
  });

  it("يحفظ موضع كل كلمة في نصّ فقرتها", () => {
    const words = stream(10, { speakerFrom: 4 });
    const { paragraphs, positions } = layoutParagraphs(words);
    words.forEach((w, i) => {
      const p = positions[i]!;
      expect(paragraphs[p.para - 1]!.text.slice(p.start, p.end)).toBe(w.text);
    });
  });

  it("يلصق علامة الترقيم المستقلة بما قبلها ويعرّب اللاتينية", () => {
    const words: Word[] = [
      { text: "كيف", startMs: 0, endMs: 100 },
      { text: "حالك", startMs: 100, endMs: 200 },
      { text: "?", startMs: 200, endMs: 200 },
    ];
    expect(layoutParagraphs(words).paragraphs[0]!.text).toBe("كيف حالك؟");
  });
});
