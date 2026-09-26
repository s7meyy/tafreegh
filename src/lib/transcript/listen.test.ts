import { describe, expect, it } from "vitest";
import { listenLayout, wordAt } from "./listen";
import type { Word } from "./types";

const timed: Word[] = ["أهلا", "بك", "الله", "يحييك", "كيف", "الحال"].map((text, i) => ({
  text,
  startMs: i * 1000,
  endMs: i * 1000 + 800,
}));

describe("listenLayout", () => {
  it("يعطي كل كلمة موضعها في النصّ وتوقيتها، ويتخطّى أسماء المتحدثين", () => {
    const text = "أ: أهلا بك\n\nب: الله يحييك\n\nأ: كيف الحال";
    const { paragraphs, words } = listenLayout(text, timed);
    expect(paragraphs.map((p) => p.speaker)).toEqual(["أ", "ب", "أ"]);
    expect(words).toHaveLength(6);
    for (const w of words) expect(text.slice(w.start, w.end)).toBe(w.text);
    expect(words[2]).toMatchObject({ text: "الله", startMs: 2000 });
  });

  it("ينقل التوقيت إلى نصّ حرّره المستخدم", () => {
    // «أهلا بك» صارت «أهلًا وسهلًا بك»
    const { words } = listenLayout("أهلًا وسهلًا بك الله يحييك كيف الحال", timed);
    expect(words.find((w) => w.text === "يحييك")!.startMs).toBe(3000);
  });

  it("يقبل نصًّا بلا متحدثين", () => {
    const { paragraphs } = listenLayout("أهلا بك\n\nالله يحييك", timed);
    expect(paragraphs.map((p) => p.speaker)).toEqual([null, null]);
  });
});

describe("wordAt", () => {
  const { words } = listenLayout("أهلا بك الله يحييك كيف الحال", timed);

  it("يجد الكلمة الجارية", () => {
    expect(wordAt(words, 2500)).toBe(2);
    expect(wordAt(words, 3000)).toBe(3);
  });

  it("قبل أول كلمة لا كلمة جارية", () => {
    expect(wordAt(words, -1)).toBe(-1);
  });

  it("بعد آخر كلمة تبقى الأخيرة", () => {
    expect(wordAt(words, 99_000)).toBe(5);
  });
});
