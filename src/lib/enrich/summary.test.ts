import { describe, expect, it } from "vitest";
import { chunks, clean } from "./summary";
import { batches } from "./tashkeel";

describe("clean", () => {
  it("يُسقط الإسناد إلى فقرة غير موجودة ويوحّد المكرر", () => {
    const out = clean(
      { brief: " خلاصة ", points: [{ text: "نقطة", paras: [3, 1, 3, 99, 0] }, { text: " ", paras: [1] }], topics: ["أ", "أ", " "] },
      5,
    );
    expect(out).toEqual({ brief: "خلاصة", points: [{ text: "نقطة", paras: [1, 3] }], topics: ["أ"] });
  });
});

describe("chunks", () => {
  it("يقسم الفقرات أجزاءً لا تتجاوز الحدّ", () => {
    const paras = ["أ".repeat(30), "ب".repeat(30), "ج".repeat(30)];
    expect(chunks(paras, 50)).toEqual([[0, 1], [1, 2], [2, 3]]);
    expect(chunks(paras, 100)).toEqual([[0, 3]]);
  });
});

describe("batches", () => {
  it("يجمع الفقرات دفعاتٍ ويُفرد الفقرة الأطول من الحدّ", () => {
    expect(batches(["أ".repeat(10), "ب".repeat(10), "ج".repeat(50), "د".repeat(5)], 25)).toEqual([[0, 1], [2], [3]]);
  });
});
