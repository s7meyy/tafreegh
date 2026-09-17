import { describe, expect, it } from "vitest";
import type { DiffSpan } from "@/lib/transcript/diff";
import type { Word } from "@/lib/transcript/types";
import { buildEvidence, formatEvidence } from "./evidence";

const paragraphs = [
  "قال الشيخ إن الأمر واضح",
  "ثم ذكر شيئًا عن الرياض",
];

function word(text: string, confidence?: number): Word {
  return { text, startMs: 0, endMs: 100, confidence };
}

describe("buildEvidence", () => {
  it("يعلّم الكلمات ضعيفة الثقة وحدها", () => {
    const spans = buildEvidence({
      paragraphs,
      words: [word("قال", 0.95), word("واضح", 0.2)],
    });
    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({ para: 1, text: "واضح", kind: "low_confidence" });
  });

  it("يتجاهل الكلمات التي لا ثقة لها أصلًا", () => {
    // Gemini لا يعطي درجات ثقة — غياب الدرجة ليس دليل ضعف
    const spans = buildEvidence({ paragraphs, words: [word("واضح")] });
    expect(spans).toEqual([]);
  });

  it("يعلّم مواضع اختلاف المحرّكين مع بديل المحرّك الآخر", () => {
    const disagreements: DiffSpan[] = [
      { aStart: 0, aEnd: 1, a: "الرياض", b: "جدة", startMs: 500, endMs: 900 },
    ];
    const spans = buildEvidence({ paragraphs, words: [], disagreements });
    expect(spans[0]).toMatchObject({
      para: 2,
      text: "الرياض",
      kind: "engine_disagreement",
      alternative: "جدة",
    });
  });

  it("يتجاهل الإضافة من المحرّك الثاني — لا موضع لها في المرجع", () => {
    const disagreements: DiffSpan[] = [
      { aStart: 3, aEnd: 3, a: "", b: "زيادة", startMs: 0, endMs: 0 },
    ];
    expect(buildEvidence({ paragraphs, words: [], disagreements })).toEqual([]);
  });

  it("يتجاهل ما لا يوجد نصّه في أي فقرة", () => {
    const spans = buildEvidence({ paragraphs, words: [word("غائبة", 0.1)] });
    expect(spans).toEqual([]);
  });

  it("لا يكرّر الموضع الواحد", () => {
    const spans = buildEvidence({
      paragraphs,
      words: [word("واضح", 0.2), word("واضح", 0.2)],
    });
    expect(spans).toHaveLength(1);
  });

  it("ينسب الكلمة المكررة إلى فقرتها لا إلى أول ورود لها", () => {
    const paras = ["ذكر الأمر أولًا", "ثم عاد فذكر الأمر مرة أخرى"];
    const spans = buildEvidence({
      paragraphs: paras,
      // الكلمات بترتيب النصّ: الفقرة الأولى ثم الثانية
      words: [word("أولًا", 0.2), word("أخرى", 0.2)],
    });
    expect(spans.map((s) => s.para)).toEqual([1, 2]);
  });

  it("يقبل ضبط عتبة الثقة", () => {
    const words = [word("واضح", 0.7)];
    expect(buildEvidence({ paragraphs, words })).toEqual([]);
    expect(buildEvidence({ paragraphs, words, confidenceFloor: 0.8 })).toHaveLength(1);
  });
});

describe("formatEvidence", () => {
  it("يذكر البديل حين يكون الدليل اختلافًا", () => {
    const text = formatEvidence([
      { para: 2, text: "الرياض", kind: "engine_disagreement", alternative: "جدة" },
    ]);
    expect(text).toContain("[2]");
    expect(text).toContain("جدة");
  });

  it("يقول صراحةً حين لا مواضع", () => {
    expect(formatEvidence([])).toBe("لا مواضع مشكوك فيها.");
  });
});
