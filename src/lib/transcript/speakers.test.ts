import { describe, expect, it } from "vitest";
import { speakerNames, speakersIn, splitSpeaker, stripSpeakers, transferSpeakers } from "./speakers";
import type { Word } from "./types";

const w = (text: string, speaker?: string): Word => ({ text, startMs: 0, endMs: 0, speaker });

describe("transferSpeakers", () => {
  it("ينقل المتحدث من المحرّك المميِّز إلى نظير كلماته", () => {
    const target = ["أهلا", "بك", "الله", "يحييك"].map((t) => w(t));
    const source = [w("أهلا", "1"), w("بك", "1"), w("الله", "2"), w("يحييك", "2")];
    expect(transferSpeakers(target, source).map((x) => x.speaker)).toEqual(["1", "1", "2", "2"]);
  });

  it("يعطي موضع الاختلاف متحدث مقابله، وما لا مقابل له متحدث سابقه", () => {
    const target = ["أهلا", "بك", "ويش", "الأخبار"].map((t) => w(t));
    const source = [w("أهلا", "1"), w("بك", "1"), w("وش", "2")];
    expect(transferSpeakers(target, source).map((x) => x.speaker)).toEqual(["1", "1", "2", "2"]);
  });

  it("لا يغيّر شيئًا حين لا متحدثين في المصدر", () => {
    const target = [w("أهلا")];
    expect(transferSpeakers(target, [w("أهلا")])).toEqual(target);
  });
});

describe("أسماء المتحدثين في النصّ", () => {
  it("يسمّي المتحدثين بأسماء المجلد بترتيب ظهورهم", () => {
    const names = speakerNames(["2", "1", "2", "3"], ["المحاور", "الضيف"]);
    expect([...names.values()]).toEqual(["المحاور", "الضيف", "المتحدث 3"]);
  });

  it("يفصل الاسم عن الكلام", () => {
    expect(splitSpeaker("المحاور: أهلا بك")).toEqual({ speaker: "المحاور", body: "أهلا بك" });
    expect(splitSpeaker("كلام بلا اسم، ثم: شيء")).toEqual({ speaker: null, body: "كلام بلا اسم، ثم: شيء" });
  });

  it("لا يعدّ افتتاحًا واحدًا بـ«قال:» اسم متحدث", () => {
    const text = "قال: هذا مهم\n\nثم مضى";
    expect(speakersIn(text).size).toBe(0);
    expect(stripSpeakers(text)).toBe(text);
  });

  it("ينزع الأسماء المتكررة وحدها", () => {
    const text = "أ: سؤال\n\nب: جواب\n\nأ: شكرا\n\nب: العفو";
    expect(stripSpeakers(text)).toBe("سؤال\n\nجواب\n\nشكرا\n\nالعفو");
  });
});
