import { describe, expect, it } from "vitest";
import { hasChanges, wordDiff } from "./word-diff";

describe("wordDiff", () => {
  it("لا فروق لنصّين متطابقين", () => {
    const segs = wordDiff("قال الشيخ كلامًا", "قال الشيخ كلامًا");
    expect(segs).toEqual([{ kind: "same", text: "قال الشيخ كلامًا" }]);
    expect(hasChanges(segs)).toBe(false);
  });

  it("يعلّم الإبدال محذوفًا ثم مضافًا", () => {
    const segs = wordDiff("سافرنا إلى الرياض أمس", "سافرنا إلى جدة أمس");
    expect(segs).toEqual([
      { kind: "same", text: "سافرنا إلى" },
      { kind: "removed", text: "الرياض" },
      { kind: "added", text: "جدة" },
      { kind: "same", text: "أمس" },
    ]);
  });

  it("يُظهر تصحيح الرسم الذي تتجاهله المحاذاة", () => {
    const segs = wordDiff("امس رحنا", "أمس رحنا");
    expect(segs).toEqual([
      { kind: "removed", text: "امس" },
      { kind: "added", text: "أمس" },
      { kind: "same", text: "رحنا" },
    ]);
  });

  it("يعلّم الحذف وحده", () => {
    const segs = wordDiff("الجو يعني يعني بارد", "الجو بارد");
    expect(segs).toEqual([
      { kind: "same", text: "الجو" },
      { kind: "removed", text: "يعني يعني" },
      { kind: "same", text: "بارد" },
    ]);
  });

  it("يحفظ فواصل الفقرات", () => {
    const segs = wordDiff("أولى\n\nثانية", "أولى\n\nثانية معدّلة");
    expect(segs.map((s) => s.kind)).toEqual(["same", "break", "same", "added"]);
  });

  it("يعلّم الإضافة في آخر النصّ", () => {
    const segs = wordDiff("واحد", "واحد\n\nسطر جديد");
    expect(hasChanges(segs)).toBe(true);
    expect(segs.at(-1)).toEqual({ kind: "added", text: "سطر جديد" });
  });
});
