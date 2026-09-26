import { describe, expect, it } from "vitest";
import type { Word } from "@/lib/transcript/types";
import { buildCues, toSrt, toVtt } from "./subtitles";

/** كلمات متتالية بلا فجوات، كل واحدة 400 مللي ثانية. */
function words(text: string, step = 500): Word[] {
  return text.split(" ").map((t, i) => ({
    text: t,
    startMs: i * step,
    endMs: i * step + 400,
  }));
}

describe("buildCues", () => {
  it("يجمع الكلمات في بطاقة واحدة ما لم تتجاوز الحدود", () => {
    const cues = buildCues(words("واحد اثنان ثلاثة"));
    expect(cues).toHaveLength(1);
    expect(cues[0]).toMatchObject({ index: 1, startMs: 0, endMs: 1400 });
    expect(cues[0]!.text).toBe("واحد اثنان ثلاثة");
  });

  it("يقطع عند بلوغ أقصى عدد كلمات", () => {
    const cues = buildCues(words("أ ب ج د هـ و ز ح ط ي"), { maxWords: 4 });
    expect(cues).toHaveLength(3);
    expect(cues[0]!.text.split(" ")).toHaveLength(4);
  });

  it("يقطع عند الوقفة الطويلة ولو لم تمتلئ البطاقة", () => {
    const list: Word[] = [
      { text: "قبل", startMs: 0, endMs: 400 },
      // فجوة ثانيتين
      { text: "بعد", startMs: 2400, endMs: 2800 },
    ];
    const cues = buildCues(list);
    expect(cues).toHaveLength(2);
    expect(cues[1]!.startMs).toBe(2400);
  });

  it("يقطع عند تجاوز المدة القصوى", () => {
    const cues = buildCues(words("أ ب ج د هـ و", 2000), { maxMs: 5000, maxWords: 99 });
    expect(cues.length).toBeGreaterThan(1);
  });

  it("يرقّم البطاقات تصاعديًا من 1", () => {
    const cues = buildCues(words("أ ب ج د هـ و ز ح"), { maxWords: 2 });
    expect(cues.map((c) => c.index)).toEqual([1, 2, 3, 4]);
  });

  it("يتجاهل الكلمات الفارغة", () => {
    const list: Word[] = [
      { text: "كلمة", startMs: 0, endMs: 400 },
      { text: "   ", startMs: 500, endMs: 600 },
    ];
    expect(buildCues(list)[0]!.text).toBe("كلمة");
  });

  it("يعيد قائمة فارغة بلا كلمات", () => {
    expect(buildCues([])).toEqual([]);
  });
});

describe("toSrt", () => {
  it("يكتب التوقيت بفاصلة عشرية ويفصل البطاقات بسطر فارغ", () => {
    const srt = toSrt(words("واحد اثنان"));
    expect(srt).toContain("00:00:00,000 --> 00:00:00,900");
    expect(srt.startsWith("1\n")).toBe(true);
  });

  it("يكتب الساعات حين تتجاوز المدة ساعة", () => {
    const late: Word[] = [{ text: "متأخرة", startMs: 3_661_000, endMs: 3_661_500 }];
    expect(toSrt(late)).toContain("01:01:01,000 --> 01:01:01,500");
  });

  it("يعيد نصًّا فارغًا بلا كلمات", () => {
    expect(toSrt([])).toBe("");
  });
});

describe("toVtt", () => {
  it("يبدأ بالترويسة ويكتب التوقيت بنقطة عشرية", () => {
    const vtt = toVtt(words("واحد اثنان"));
    expect(vtt.startsWith("WEBVTT\n\n")).toBe(true);
    expect(vtt).toContain("00:00:00.000 --> 00:00:00.900");
  });

  it("يبقي الترويسة حتى بلا بطاقات", () => {
    expect(toVtt([]).trim()).toBe("WEBVTT");
  });
});

describe("buildCues — حدود طبيعية", () => {
  it("لا يترك كلمة يتيمة في بطاقة وحدها", () => {
    const list: Word[] = [
      ...words("وعليكم السلام ورحمة الله وبركاته، الله", 850),
      { text: "يحييك", startMs: 5100, endMs: 6000 },
    ];
    const cues = buildCues(list, { maxMs: 5000 });
    expect(cues.at(-1)!.text.split(" ").length).toBeGreaterThan(1);
  });

  it("يقطع عند الفاصلة لا في وسط العبارة", () => {
    const cues = buildCues(words("أهلًا بك، كيف حالك اليوم يا صديقي"), { maxWords: 5 });
    expect(cues[0]!.text).toBe("أهلًا بك،");
  });

  it("لا تجمع البطاقة كلام متحدثين", () => {
    const list = words("سؤال قصير جواب قصير").map((w, i) => ({
      ...w,
      speaker: i < 2 ? "أ" : "ب",
    }));
    expect(buildCues(list).map((c) => c.text)).toEqual(["سؤال قصير", "جواب قصير"]);
  });
});
