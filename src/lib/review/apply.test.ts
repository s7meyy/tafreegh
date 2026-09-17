import { describe, expect, it } from "vitest";
import { applyEdits, toParagraphs } from "./apply";
import type { EvidenceSpan, ProposedEdit } from "./types";

const paragraphs = [
  "قال الشيخ ان الامر واضح ولا يحتاج بيان",
  "وذكر عبد الله بن سعود شيئا من ذلك",
];

function edit(partial: Partial<ProposedEdit>): ProposedEdit {
  return {
    para: 1,
    from: "ان",
    to: "أن",
    reason: "orthography",
    ...partial,
  };
}

describe("toParagraphs", () => {
  it("يقسّم عند الأسطر الفارغة ويحذف الفراغ", () => {
    expect(toParagraphs("  أولى  \n\n\n ثانية \n\n")).toEqual(["أولى", "ثانية"]);
  });

  it("يعيد قائمة فارغة لنصّ فارغ", () => {
    expect(toParagraphs("   \n\n  ")).toEqual([]);
  });
});

describe("applyEdits — القبول", () => {
  it("يقبل تصحيح الرسم الإملائي بلا دليل", () => {
    const result = applyEdits(paragraphs, [edit({})]);
    expect(result.applied).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);
    expect(result.text).toContain("قال الشيخ أن الامر");
  });

  it("يستبدل أول ورود فقط", () => {
    const paras = ["كان كان الرجل هناك"];
    const result = applyEdits(paras, [
      edit({ from: "كان", to: "كانَ", reason: "orthography" }),
    ]);
    expect(result.text).toBe("كانَ كان الرجل هناك");
  });

  it("يقبل تعديل المسرد حين ينتهي إلى مصطلح فيه", () => {
    const result = applyEdits(
      paragraphs,
      [edit({ para: 2, from: "عبد الله", to: "عبدالله", reason: "glossary" })],
      { glossary: ["عبدالله بن سعود"] },
    );
    expect(result.applied).toHaveLength(1);
  });

  it("يقبل حذف التلعثم مهما طال", () => {
    const paras = ["يعني يعني يعني الموضوع أن كذا"];
    const result = applyEdits(paras, [
      edit({ from: "يعني يعني يعني ", to: "", reason: "disfluency" }),
    ]);
    expect(result.applied).toHaveLength(1);
    expect(result.text).toBe("الموضوع أن كذا");
  });

  it("يطبّق عدة تعديلات على فقرات مختلفة", () => {
    const result = applyEdits(paragraphs, [
      edit({ para: 1, from: "ان", to: "أن" }),
      edit({ para: 2, from: "شيئا", to: "شيئًا" }),
    ]);
    expect(result.applied).toHaveLength(2);
    expect(result.text).toContain("شيئًا");
  });
});

describe("applyEdits — الرفض", () => {
  it("يرفض تعديلًا لا يوجد نصّه في الفقرة", () => {
    const result = applyEdits(paragraphs, [
      edit({ from: "كلام غير موجود", to: "بديل" }),
    ]);
    expect(result.applied).toHaveLength(0);
    expect(result.rejected[0]!.code).toBe("text_not_found");
    expect(result.text).toBe(paragraphs.join("\n\n"));
  });

  it("يرفض رقم فقرة خارج المدى", () => {
    const result = applyEdits(paragraphs, [edit({ para: 99 })]);
    expect(result.rejected[0]!.code).toBe("unknown_paragraph");
  });

  it("يرفض سببًا خارج القائمة المغلقة", () => {
    const result = applyEdits(paragraphs, [
      edit({ reason: "improvement" as never }),
    ]);
    expect(result.rejected[0]!.code).toBe("unknown_reason");
  });

  it("يرفض تعديلًا لا يغيّر شيئًا", () => {
    const result = applyEdits(paragraphs, [edit({ from: "ان", to: "ان" })]);
    expect(result.rejected[0]!.code).toBe("no_change");
  });

  it("يرفض تعليل المسرد بمصطلح ليس فيه", () => {
    const result = applyEdits(
      paragraphs,
      [edit({ para: 2, from: "عبد الله", to: "عبيد الله", reason: "glossary" })],
      { glossary: ["عبدالله بن سعود"] },
    );
    expect(result.rejected[0]!.code).toBe("not_in_glossary");
  });

  it("يرفض تبديل كلام بلا دليل — وهذا أهم ما تحرسه هذه الطبقة", () => {
    const result = applyEdits(paragraphs, [
      edit({ from: "واضح", to: "بيّن", reason: "low_confidence" }),
    ]);
    expect(result.applied).toHaveLength(0);
    expect(result.rejected[0]!.code).toBe("no_evidence");
  });

  it("يقبل التبديل نفسه حين يقوم عليه دليل", () => {
    const evidence: EvidenceSpan[] = [
      { para: 1, text: "واضح", kind: "low_confidence" },
    ];
    const result = applyEdits(
      paragraphs,
      [edit({ from: "واضح", to: "بيّن", reason: "low_confidence" })],
      { evidence },
    );
    expect(result.applied).toHaveLength(1);
  });

  it("يرفض إعادة صياغة جملة متذرّعة بالترقيم", () => {
    const result = applyEdits(paragraphs, [
      edit({
        from: "ولا يحتاج بيان",
        to: "وليس بحاجة إلى مزيد من البيان",
        reason: "punctuation",
      }),
    ]);
    expect(result.rejected[0]!.code).toBe("too_large");
  });

  it("لا يمسّ النصّ حين تُرفض كل التعديلات", () => {
    const result = applyEdits(paragraphs, [
      edit({ from: "غير موجود" }),
      edit({ para: 50 }),
    ]);
    expect(result.text).toBe(paragraphs.join("\n\n"));
    expect(result.rejected).toHaveLength(2);
  });

  it("الدليل في فقرة لا يبيح التعديل في فقرة أخرى", () => {
    const evidence: EvidenceSpan[] = [
      { para: 2, text: "شيئا", kind: "engine_disagreement" },
    ];
    const result = applyEdits(
      paragraphs,
      [edit({ para: 1, from: "واضح", to: "ظاهر", reason: "engine_disagreement" })],
      { evidence },
    );
    expect(result.rejected[0]!.code).toBe("no_evidence");
  });
});
