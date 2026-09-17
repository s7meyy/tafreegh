import { describe, expect, it } from "vitest";
import { mergeSegments, wordsToText, type SegmentTranscript } from "./merge";
import type { Word } from "./types";

/** يبني كلمات بتوقيت منتظم (كل كلمة 500 مللي ثانية) بدءًا من `fromMs`. */
function words(text: string, fromMs = 0): Word[] {
  return text.split(" ").map((t, i) => ({
    text: t,
    startMs: fromMs + i * 500,
    endMs: fromMs + i * 500 + 400,
  }));
}

function part(
  index: number,
  startMs: number,
  overlapMs: number,
  text: string,
): SegmentTranscript {
  const w = words(text);
  return {
    plan: {
      index,
      startMs,
      endMs: startMs + (w.at(-1)?.endMs ?? 0),
      overlapMs,
    },
    words: w,
  };
}

describe("mergeSegments", () => {
  it("يعيد مقطعًا واحدًا كما هو مع توقيت مطلق", () => {
    const merged = mergeSegments([part(0, 1000, 0, "السلام عليكم")]);
    expect(wordsToText(merged)).toBe("السلام عليكم");
    expect(merged[0]!.startMs).toBe(1000);
  });

  it("يلحم عند المطابقة النصية فلا يكرّر كلام التداخل", () => {
    // المقطع الثاني يبدأ بإعادة آخر أربع كلمات من الأول
    const a = part(0, 0, 0, "الحمد لله رب العالمين والصلاة على النبي");
    const b = part(1, 2500, 2000, "والصلاة على النبي محمد وعلى آله");

    const merged = mergeSegments([a, b]);
    expect(wordsToText(merged)).toBe(
      "الحمد لله رب العالمين والصلاة على النبي محمد وعلى آله",
    );
  });

  it("يرتّب المقاطع بالفهرس لا بترتيب الوصول", () => {
    const a = part(0, 0, 0, "واحد اثنان ثلاثة");
    const b = part(1, 1500, 0, "أربعة خمسة");
    expect(wordsToText(mergeSegments([b, a]))).toBe("واحد اثنان ثلاثة أربعة خمسة");
  });

  it("يقصّ عند منتصف التداخل حين لا توجد مطابقة", () => {
    // لا كلمة مشتركة بين ذيل الأول ورأس الثاني
    const a = part(0, 0, 0, "ألف باء تاء ثاء");
    const b = part(1, 1000, 1000, "صاد ضاد طاء ظاء");

    const merged = mergeSegments([a, b]);
    const text = wordsToText(merged);
    // لا تكرار، ولا فقدان للطرفين البعيدين عن منطقة القصّ
    expect(text.startsWith("ألف باء")).toBe(true);
    expect(text.endsWith("طاء ظاء")).toBe(true);
    expect(new Set(text.split(" ")).size).toBe(text.split(" ").length);
  });

  it("يتجاهل المقاطع الفارغة", () => {
    const a = part(0, 0, 0, "واحد اثنان");
    const empty: SegmentTranscript = {
      plan: { index: 1, startMs: 1000, endMs: 2000, overlapMs: 500 },
      words: [],
    };
    expect(wordsToText(mergeSegments([a, empty]))).toBe("واحد اثنان");
  });

  it("يلحم رغم اختلاف رسم الهمزة بين المقطعين", () => {
    const a = part(0, 0, 0, "قال إبراهيم عليه السلام");
    const b = part(1, 1000, 1500, "ابراهيم عليه السلام لأبيه");

    expect(wordsToText(mergeSegments([a, b]))).toBe(
      "قال إبراهيم عليه السلام لأبيه",
    );
  });
});
