import { describe, expect, it } from "vitest";
import { composeSegments } from "./document";
import { applyTurns, remapPosition } from "./turns";

const paragraphs = [
  "أهلا بك في البرنامج، عرفنا بنفسك. أنا عبدالله من بريدة.",
  "كم نخلة عندك؟",
  "عندي خمسمية نخلة تقريبا.",
];

describe("applyTurns", () => {
  it("يقسم الفقرة حيث تبدأ مداخلة في وسطها ويسمّي كل مداخلة", () => {
    const { segments } = applyTurns(paragraphs, [
      { para: 1, quote: "", speaker: 1 },
      { para: 1, quote: "أنا عبدالله من", speaker: 2 },
      { para: 2, quote: "", speaker: 1 },
      { para: 3, quote: "", speaker: 2 },
    ]);
    expect(segments.map((s) => `${s.speaker}|${s.text}`)).toEqual([
      "1|أهلا بك في البرنامج، عرفنا بنفسك.",
      "2|أنا عبدالله من بريدة.",
      "1|كم نخلة عندك؟",
      "2|عندي خمسمية نخلة تقريبا.",
    ]);
  });

  it("لا يغيّر كلمة من النصّ", () => {
    const { segments } = applyTurns(paragraphs, [
      { para: 1, quote: "عرفنا بنفسك", speaker: 2 },
      { para: 3, quote: "خمسمية", speaker: 1 },
    ]);
    const words = (t: string) => t.split(/\s+/).filter(Boolean);
    expect(segments.flatMap((s) => words(s.text))).toEqual(paragraphs.flatMap(words));
  });

  it("يُسقط مداخلة لا يوجد اقتباسها حرفيًا أو فقرتها", () => {
    const { applied } = applyTurns(paragraphs, [
      { para: 1, quote: "مرحبا بكم", speaker: 1 },
      { para: 9, quote: "", speaker: 2 },
      { para: 2, quote: "", speaker: 1 },
    ]);
    expect(applied).toBe(1);
  });

  it("لا يقطع داخل كلمة", () => {
    const { segments } = applyTurns(["البرنامج برنامج"], [{ para: 1, quote: "برنامج", speaker: 2 }]);
    expect(segments.map((s) => s.text)).toEqual(["البرنامج", "برنامج"]);
  });

  it("ينقل المواضع إلى الفقرات الجديدة", () => {
    const { segments } = applyTurns(paragraphs, [
      { para: 1, quote: "", speaker: 1 },
      { para: 1, quote: "أنا عبدالله", speaker: 2 },
    ]);
    const offset = paragraphs[0]!.indexOf("بريدة");
    expect(remapPosition(segments, 1, offset)).toEqual({
      para: 2,
      offset: "أنا عبدالله من ".length,
    });
    expect(remapPosition(segments, 3, 4)).toEqual({ para: 4, offset: 4 });
  });
});

describe("composeSegments", () => {
  it("يكتب أسماء المجلد بترتيب ظهور المتحدثين", () => {
    const text = composeSegments(
      [
        { text: "سؤال", speaker: "1" },
        { text: "جواب", speaker: "2" },
      ],
      ["المحاور", "الضيف"],
    );
    expect(text).toBe("المحاور: سؤال\n\nالضيف: جواب");
  });
});
