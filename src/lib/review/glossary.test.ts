import { describe, expect, it } from "vitest";
import { applyGlossaryVariants } from "./glossary";

const entries = [
  { term: "عبدالله بن سعود", variants: ["عبد الله بن سعود", "عبدالله ابن سعود"] },
  { term: "القصيم", variants: ["القسيم"] },
];

describe("applyGlossaryVariants", () => {
  it("يستبدل الشكل الخاطئ بالمصطلح", () => {
    const out = applyGlossaryVariants(["زرنا عبد الله بن سعود في القسيم"], entries);
    expect(out.paragraphs[0]).toBe("زرنا عبدالله بن سعود في القصيم");
    expect(out.edits).toHaveLength(2);
    expect(out.edits[0]).toMatchObject({ para: 1, reason: "glossary" });
  });

  it("يستبدل كل الورودات ويسجّل تعديلًا لكل واحد", () => {
    const out = applyGlossaryVariants(["القسيم ثم القسيم"], entries);
    expect(out.paragraphs[0]).toBe("القصيم ثم القصيم");
    expect(out.edits).toHaveLength(2);
  });

  it("لا يمسّ كلمة أطول تحتوي الشكل", () => {
    const out = applyGlossaryVariants(["منطقة القسيمية"], entries);
    expect(out.paragraphs[0]).toBe("منطقة القسيمية");
    expect(out.edits).toEqual([]);
  });

  it("لا يمسّ الشكل الملتصق بسابقة — المحافظة أولى", () => {
    const out = applyGlossaryVariants(["وعبد الله بن سعود"], entries);
    expect(out.paragraphs[0]).toBe("وعبد الله بن سعود");
  });

  it("يطابق مع علامات الترقيم المجاورة", () => {
    const out = applyGlossaryVariants(["من القسيم، ثم"], entries);
    expect(out.paragraphs[0]).toBe("من القصيم، ثم");
  });

  it("يحترم ترقيم الفقرات", () => {
    const out = applyGlossaryVariants(["لا شيء", "في القسيم"], entries);
    expect(out.edits[0]!.para).toBe(2);
  });

  it("يتجاهل الشكل المطابق للمصطلح والشكل الفارغ", () => {
    const out = applyGlossaryVariants(["القصيم"], [{ term: "القصيم", variants: ["القصيم", " "] }]);
    expect(out.edits).toEqual([]);
  });

  it("يعامل رموز التعابير النمطية في الشكل حرفيًا", () => {
    // بلا تهريب، «(1+1)» تعبير يطابق «11» ولا يطابق نفسه
    const out = applyGlossaryVariants(["سعر (1+1) و 11 هنا"], [{ term: "اثنان", variants: ["(1+1)"] }]);
    expect(out.paragraphs[0]).toBe("سعر اثنان و 11 هنا");
    expect(out.edits).toHaveLength(1);
  });
});
