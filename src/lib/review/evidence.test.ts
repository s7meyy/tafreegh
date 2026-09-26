import { describe, expect, it } from "vitest";
import type { DiffSpan } from "@/lib/transcript/diff";
import { layoutParagraphs } from "@/lib/transcript/layout";
import type { Word } from "@/lib/transcript/types";
import { buildEvidence, formatEvidence } from "./evidence";
import type { EvidenceSpan } from "./types";

/** كلمات فقرتين (متحدثان مختلفان يقسمانها)، وثقة اختيارية لكل كلمة. */
function doc(
  first: string,
  second: string,
  confidence: Record<number, number> = {},
): { words: Word[]; input: { paragraphs: string[]; positions: ReturnType<typeof layoutParagraphs>["positions"] } } {
  const tokens = [
    ...first.split(" ").map((t) => ({ t, s: "أ" })),
    ...second.split(" ").map((t) => ({ t, s: "ب" })),
  ];
  const words: Word[] = tokens.map(({ t, s }, i) => ({
    text: t,
    startMs: i * 500,
    endMs: i * 500 + 400,
    speaker: s,
    ...(confidence[i] !== undefined ? { confidence: confidence[i] } : {}),
  }));
  const layout = layoutParagraphs(words);
  return {
    words,
    input: { paragraphs: layout.paragraphs.map((p) => p.text), positions: layout.positions },
  };
}

const diff = (aStart: number, aEnd: number, a: string, b: string): DiffSpan => ({
  aStart,
  aEnd,
  bStart: aStart,
  bEnd: aStart + (b ? 1 : 0),
  a,
  b,
  startMs: aStart * 500,
  endMs: aEnd * 500,
});

describe("buildEvidence", () => {
  it("يعلّم الكلمات ضعيفة الثقة وحدها", () => {
    const d = doc("قال الشيخ إن الأمر واضح", "ثم ذكر الرياض", { 0: 0.95, 4: 0.2 });
    const spans = buildEvidence({ ...d.input, words: d.words });
    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({ para: 1, text: "واضح", kind: "low_confidence", offset: "قال الشيخ إن الأمر ".length });
  });

  it("يتجاهل الكلمات التي لا ثقة لها أصلًا", () => {
    // Gemini لا يعطي درجات ثقة — غياب الدرجة ليس دليل ضعف
    const d = doc("قال الشيخ", "ثم ذكر");
    expect(buildEvidence({ ...d.input, words: d.words })).toEqual([]);
  });

  it("يعلّم مواضع اختلاف المحرّكين مع بديل المحرّك الآخر", () => {
    const d = doc("قال الشيخ", "ثم ذكر الرياض");
    const spans = buildEvidence({ ...d.input, words: d.words, disagreements: [diff(4, 5, "الرياض", "جدة")] });
    expect(spans[0]).toMatchObject({
      para: 2,
      text: "الرياض",
      kind: "engine_disagreement",
      alternative: "جدة",
      severity: "medium",
    });
  });

  it("يتجاهل الإضافة من المحرّك الثاني — لا موضع لها في المرجع", () => {
    const d = doc("قال الشيخ", "ثم ذكر");
    const spans = buildEvidence({ ...d.input, words: d.words, disagreements: [diff(3, 3, "", "زيادة")] });
    expect(spans).toEqual([]);
  });

  it("لا يعدّ كتابة العدد بالحروف والأرقام خلافًا", () => {
    const d = doc("عندي عشرين نخلة", "و ثلاثمية كرتون");
    const spans = buildEvidence({
      ...d.input,
      words: d.words,
      disagreements: [diff(1, 2, "عشرين", "20"), diff(4, 5, "ثلاثمية", "300")],
    });
    expect(spans).toEqual([]);
  });

  it("لا يعدّ الفصل والوصل خلافًا", () => {
    const d = doc("أنا عبد الله", "من بريدة");
    const spans = buildEvidence({ ...d.input, words: d.words, disagreements: [diff(1, 3, "عبد الله", "عبدالله")] });
    expect(spans).toEqual([]);
  });

  it("يرفع درجة الشك حين يجتمع الدليلان، ويخفضها لكلمة أسقطها المحرّك الآخر", () => {
    const d = doc("قال الشيخ كلامًا", "ثم ذكر الرياض", { 4: 0.3 });
    const spans = buildEvidence({
      ...d.input,
      words: d.words,
      disagreements: [diff(2, 3, "كلامًا", ""), diff(4, 5, "ذكر", "ذكرى")],
    });
    expect(spans.map((s) => s.severity)).toEqual(["low", "high"]);
    // الكلمة ضعيفة الثقة داخل موضع الاختلاف لا تُعرض مرتين
    expect(spans).toHaveLength(2);
  });

  it("يعلّم الكلمة المكررة في موضعها لا في أول ورود لها", () => {
    const d = doc("الله يحييك يا الله", "ثم ذكر", { 3: 0.2 });
    const spans = buildEvidence({ ...d.input, words: d.words });
    expect(spans[0]).toMatchObject({ text: "الله", offset: "الله يحييك يا ".length });
  });

  it("يتجاهل كلمة لم يعد لها موضع (حسمها المسرد)", () => {
    const d = doc("قال الشيخ", "ثم ذكر", { 1: 0.2 });
    const positions = [...d.input.positions];
    positions[1] = null;
    expect(buildEvidence({ ...d.input, positions, words: d.words })).toEqual([]);
  });

  it("يقبل ضبط عتبة الثقة", () => {
    const d = doc("قال واضح", "ثم", { 1: 0.7 });
    expect(buildEvidence({ ...d.input, words: d.words })).toEqual([]);
    expect(buildEvidence({ ...d.input, words: d.words, confidenceFloor: 0.8 })).toHaveLength(1);
  });
});

describe("formatEvidence", () => {
  const span: EvidenceSpan = {
    id: 1,
    para: 2,
    offset: 7,
    text: "الرياض",
    kind: "engine_disagreement",
    alternative: "جدة",
    severity: "medium",
  };

  it("يذكر البديل والسياق حين يكون الدليل اختلافًا", () => {
    const text = formatEvidence([span], ["أولى", "ثم ذكر الرياض أمس"]);
    expect(text).toContain("[2]");
    expect(text).toContain("جدة");
    expect(text).toContain("ثم ذكر ⟦الرياض⟧ أمس");
  });

  it("يقول صراحةً حين لا مواضع", () => {
    expect(formatEvidence([])).toBe("لا مواضع مشكوك فيها.");
  });
});

describe("buildEvidence — مع المسرد", () => {
  it("يُسقط موضع الاختلاف الذي حسم المسرد بعضه — بديله يشمل المصطلح", () => {
    const d = doc("جامعة القسيم ما", "شاء الله");
    const positions = [...d.input.positions];
    positions[1] = null; // «القسيم» صحّحها المسرد
    const spans = buildEvidence({
      ...d.input,
      positions,
      words: d.words,
      disagreements: [diff(1, 3, "القسيم ما", "القصيم.")],
    });
    expect(spans).toEqual([]);
  });
});

describe("buildEvidence — البديل المقترح", () => {
  it("يضع بديل المحرّك الآخر مكان الكلمة المشكوك فيها وحدها", () => {
    const d = doc("وش يعني الصرم للي", "ما يعرفه", { 2: 0.3 });
    const [s] = buildEvidence({ ...d.input, words: d.words, disagreements: [diff(2, 4, "الصرم للي", "الصرام")] });
    expect(s!.suggestion).toBe("الصرام للي");
  });

  it("يقترح البديل كما هو حين يقابل الموضع كلمة بكلمة", () => {
    const d = doc("قال ويش", "ثم");
    const [s] = buildEvidence({ ...d.input, words: d.words, disagreements: [diff(1, 2, "ويش", "وش")] });
    expect(s!.suggestion).toBe("وش");
  });

  it("لا يقترح بديلًا يحذف كلامًا بلا شك فيه", () => {
    const d = doc("قال الصرم للي", "ثم");
    const [s] = buildEvidence({ ...d.input, words: d.words, disagreements: [diff(1, 3, "الصرم للي", "الصرام")] });
    expect(s!.suggestion).toBeUndefined();
  });
});
