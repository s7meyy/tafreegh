import { describe, expect, it } from "vitest";
import { applyVerdicts, reconcile, type EditVerdict } from "./stage3";
import type { ProposedEdit } from "./types";

const edits: ProposedEdit[] = [
  { para: 1, from: "ان", to: "أن", reason: "orthography" },
  { para: 1, from: "واضح", to: "بيّن", reason: "low_confidence" },
  { para: 2, from: "شيئا", to: "شيئًا", reason: "orthography" },
];

describe("reconcile", () => {
  it("يحكم على كل تعديل ولو أغفل النموذج بعضها", () => {
    const result = reconcile([{ index: 0, verdict: "accept" }], edits.length);
    expect(result).toHaveLength(3);
    expect(result[0]!.verdict).toBe("accept");
    // ما لم يُحكم عليه يُرفض — الافتراض النصّ الأصلي
    expect(result[1]!.verdict).toBe("reject");
    expect(result[2]!.verdict).toBe("reject");
  });

  it("يتجاهل رقمًا خارج المدى", () => {
    const result = reconcile(
      [
        { index: 99, verdict: "accept" },
        { index: -1, verdict: "accept" },
        { index: 0, verdict: "accept" },
      ],
      edits.length,
    );
    expect(result.filter((v) => v.verdict === "accept")).toHaveLength(1);
  });

  it("يأخذ الحكم الأول عند التكرار", () => {
    const result = reconcile(
      [
        { index: 0, verdict: "accept" },
        { index: 0, verdict: "reject" },
      ],
      edits.length,
    );
    expect(result[0]!.verdict).toBe("accept");
  });

  it("يعامل replace بلا بديل رفضًا", () => {
    const result = reconcile([{ index: 0, verdict: "replace", to: "  " }], edits.length);
    expect(result[0]!.verdict).toBe("reject");
  });

  it("يعيد قائمة فارغة حين لا تعديلات", () => {
    expect(reconcile([], 0)).toEqual([]);
  });
});

describe("applyVerdicts", () => {
  it("يبقي المقبول ويسقط المرفوض", () => {
    const verdicts: EditVerdict[] = [
      { index: 0, verdict: "accept" },
      { index: 1, verdict: "reject" },
      { index: 2, verdict: "accept" },
    ];
    const out = applyVerdicts(edits, verdicts);
    expect(out.map((e) => e.from)).toEqual(["ان", "شيئا"]);
  });

  it("يستبدل البديل حين يكون الحكم replace", () => {
    const out = applyVerdicts(edits, [{ index: 1, verdict: "replace", to: "ظاهر" }]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ from: "واضح", to: "ظاهر", reason: "low_confidence" });
  });

  it("يسقط replace بلا بديل", () => {
    expect(applyVerdicts(edits, [{ index: 0, verdict: "replace" }])).toEqual([]);
  });

  it("يعيد قائمة فارغة حين تُرفض كل التعديلات", () => {
    const verdicts = edits.map((_, i) => ({ index: i, verdict: "reject" as const }));
    expect(applyVerdicts(edits, verdicts)).toEqual([]);
  });
});
