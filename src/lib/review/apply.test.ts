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

let nextId = 1;
function span(partial: Partial<EvidenceSpan> & Pick<EvidenceSpan, "para" | "text" | "offset">): EvidenceSpan {
  return { id: nextId++, kind: "low_confidence", severity: "medium", ...partial };
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
      span({ para: 1, text: "واضح", kind: "low_confidence", offset: paragraphs[0]!.indexOf("واضح") }),
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
    expect(result.rejected[0]!.code).toBe("not_punctuation");
  });

  it("يرفض ترقيمًا واسعًا بلا دليل ولو لم يغيّر الكلمات", () => {
    const result = applyEdits(paragraphs, [
      edit({ from: "واضح ولا يحتاج بيان", to: "واضح، ولا يحتاج بيان.", reason: "punctuation" }),
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
      span({ para: 2, text: "شيئا", kind: "engine_disagreement", offset: paragraphs[1]!.indexOf("شيئا") }),
    ];
    const result = applyEdits(
      paragraphs,
      [edit({ para: 1, from: "واضح", to: "ظاهر", reason: "engine_disagreement" })],
      { evidence },
    );
    expect(result.rejected[0]!.code).toBe("no_evidence");
  });
});

describe("applyEdits — التعديل في موضع دليله", () => {
  it("يصحّح الكلمة المكررة حيث قام الدليل، لا في أول ورودها", () => {
    // «ورحمة الله» في أول الفقرة سليمة؛ الشك في «الله» الثانية وحدها
    const paras = ["السلام عليكم ورحمة الله، أنا الله بن سعود"];
    const offset = paras[0]!.lastIndexOf("الله");
    const result = applyEdits(
      paras,
      [edit({ from: "الله", to: "عبدالله", reason: "low_confidence" })],
      { evidence: [span({ para: 1, text: "الله", offset })] },
    );
    expect(result.text).toBe("السلام عليكم ورحمة الله، أنا عبدالله بن سعود");
    expect(result.applied[0]!.at).toBe(offset);
  });

  it("يطبّق التعديل المتكرر على كل موضع من مواضع دليله", () => {
    const paras = ["ويش أنواع التمر؟ ويش تسوون؟"];
    const evidence = [
      span({ para: 1, text: "ويش", offset: 0, kind: "engine_disagreement" }),
      span({ para: 1, text: "ويش", offset: paras[0]!.lastIndexOf("ويش"), kind: "engine_disagreement" }),
    ];
    const twice = [1, 2].map(() => edit({ from: "ويش", to: "وش", reason: "engine_disagreement" }));
    const result = applyEdits(paras, twice, { evidence });
    expect(result.text).toBe("وش أنواع التمر؟ وش تسوون؟");
    expect(result.applied.flatMap((e) => e.spanIds).sort()).toEqual(evidence.map((e) => e.id).sort());
  });

  it("يرفض التعديل حين يقع النصّ خارج موضع الدليل", () => {
    const paras = ["من الرياض إلى من"];
    const result = applyEdits(
      paras,
      [edit({ from: "الرياض", to: "جدة", reason: "engine_disagreement" })],
      // الدليل على «من» الأخيرة لا على «الرياض»
      { evidence: [span({ para: 1, text: "من", offset: 14, kind: "engine_disagreement" })] },
    );
    expect(result.rejected[0]!.code).toBe("no_evidence");
  });

  it("يحمل توقيت الدليل إلى التعديل المطبّق", () => {
    const paras = ["قال واضح"];
    const result = applyEdits(
      paras,
      [edit({ from: "واضح", to: "بيّن", reason: "low_confidence" })],
      { evidence: [span({ para: 1, text: "واضح", offset: 4, startMs: 1200, endMs: 1600 })] },
    );
    expect(result.applied[0]).toMatchObject({ startMs: 1200, endMs: 1600 });
  });

  it("ينقل مواضع الأدلة بعد تعديل سابق في الفقرة نفسها", () => {
    const paras = ["ان الامر ان"];
    const result = applyEdits(
      paras,
      [
        edit({ from: "الامر", to: "الأمر المعروف", reason: "orthography" }),
        edit({ from: "ان", to: "إن", reason: "low_confidence" }),
      ],
      { evidence: [span({ para: 1, text: "ان", offset: 9 })] },
    );
    // الأول مرفوض (يغيّر الكلمة)، فالثاني يقع على «ان» الأخيرة
    expect(result.text).toBe("ان الامر إن");
  });

  it("لا يطابق النصّ داخل كلمة أطول", () => {
    const result = applyEdits(["منطقة من القصيم"], [edit({ from: "من", to: "مِن" })]);
    expect(result.text).toBe("منطقة مِن القصيم");
  });
});

describe("applyEdits — السبب يُمتحن بالتعديل", () => {
  it("يرفض «تصحيح رسم» يبدّل الكلمة نفسها", () => {
    const result = applyEdits(["وش تبي"], [edit({ from: "وش", to: "ماذا" })]);
    expect(result.rejected[0]!.code).toBe("not_orthography");
  });

  it("يقبل الوصل والفصل والهمزة تصحيحَ رسم", () => {
    const result = applyEdits(
      ["عبد الله قال شي"],
      [edit({ from: "عبد الله", to: "عبدالله" }), edit({ from: "شي", to: "شيء" })],
    );
    expect(result.applied).toHaveLength(2);
  });

  it("يرفض «ترقيمًا» يغيّر الكلمات", () => {
    const result = applyEdits(["قال هذا"], [edit({ from: "هذا", to: "ذلك،", reason: "punctuation" })]);
    expect(result.rejected[0]!.code).toBe("not_punctuation");
  });

  it("يرفض «حذف حشو» يضيف كلامًا", () => {
    const result = applyEdits(
      ["يعني الموضوع"],
      [edit({ from: "يعني الموضوع", to: "الموضوع المهم", reason: "disfluency" })],
    );
    expect(result.rejected[0]!.code).toBe("not_disfluency");
  });
});

describe("applyEdits — حدود الدليل", () => {
  it("يرفض حذف كلمة لم يشكّ فيها المحرّك لأن الآخر أسقطها", () => {
    const paras = ["وش يعني الصرم للي ما يعرفه"];
    const at = paras[0]!.indexOf("الصرم");
    const result = applyEdits(
      paras,
      [edit({ from: "الصرم للي", to: "الصرام", reason: "engine_disagreement" })],
      { evidence: [span({ para: 1, text: "الصرم للي", offset: at, kind: "engine_disagreement" })] },
    );
    expect(result.rejected[0]!.code).toBe("drops_words");
  });

  it("يقبل حذف كلمة شكّ فيها المحرّك نفسه", () => {
    const paras = ["ذا الحين نروح"];
    const result = applyEdits(
      paras,
      [edit({ from: "ذا الحين", to: "الحين", reason: "engine_disagreement" })],
      { evidence: [span({ para: 1, text: "ذا الحين", offset: 0, kind: "engine_disagreement", weak: ["ذا"] })] },
    );
    expect(result.applied).toHaveLength(1);
  });

  it("الشك في كلمة لا يبيح حذف جارتها", () => {
    const paras = ["يعني الصرم للي ما يعرفه"];
    const at = paras[0]!.indexOf("الصرم");
    const result = applyEdits(
      paras,
      [edit({ from: "الصرم للي", to: "الصرام", reason: "engine_disagreement" })],
      {
        evidence: [
          span({ para: 1, text: "الصرم للي", offset: at, kind: "engine_disagreement", lowConfidence: true, weak: ["الصرم"] }),
        ],
      },
    );
    expect(result.rejected[0]!.code).toBe("drops_words");
  });

  it("يقبل اقتباس ما حول الموضع للتعيين ما دام باقيًا في البديل", () => {
    const paras = ["في جامعة القسيم اليوم"];
    const at = paras[0]!.indexOf("القسيم");
    const result = applyEdits(
      paras,
      [edit({ from: "جامعة القسيم", to: "جامعة القصيم", reason: "low_confidence" })],
      { evidence: [span({ para: 1, text: "القسيم", offset: at })] },
    );
    expect(result.text).toBe("في جامعة القصيم اليوم");
  });

  it("يرفض تغيير ما حول الموضع", () => {
    const paras = ["في جامعة القسيم اليوم"];
    const at = paras[0]!.indexOf("القسيم");
    const result = applyEdits(
      paras,
      [edit({ from: "جامعة القسيم", to: "كلية القصيم", reason: "low_confidence" })],
      { evidence: [span({ para: 1, text: "القسيم", offset: at })] },
    );
    expect(result.rejected[0]!.code).toBe("outside_evidence");
  });
});
