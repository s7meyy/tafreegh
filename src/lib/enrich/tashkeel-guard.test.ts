import { describe, expect, it } from "vitest";
import { guardTashkeel, stripTashkeel } from "./tashkeel-guard";

describe("guardTashkeel", () => {
  it("يقبل تشكيلًا لا يغيّر حرفًا", () => {
    const out = guardTashkeel("السلام عليكم", "السَّلَامُ عَلَيْكُمْ");
    expect(out).toEqual({ text: "السَّلَامُ عَلَيْكُمْ", rejected: 0 });
  });

  it("يردّ تشكيل كلمة غيّر النموذج حروفها ويقبل جاراتها", () => {
    // «وش» صارت «وَشُو» — تفصيح لا تشكيل
    const out = guardTashkeel("وش أنواع التمور", "وَشُو أَنْوَاعُ التُّمُورِ");
    expect(out.text).toBe("وش أَنْوَاعُ التُّمُورِ");
    expect(out.rejected).toBe(1);
  });

  it("لا يُسقط كلمة أسقطها النموذج", () => {
    const out = guardTashkeel("قال الشيخ كلامًا مهمًا", "قَالَ الشَّيْخُ مُهِمًّا");
    expect(stripTashkeel(out.text)).toBe(stripTashkeel("قال الشيخ كلامًا مهمًا"));
    expect(out.rejected).toBe(1);
  });

  it("لا يقبل كلمة أضافها النموذج", () => {
    const out = guardTashkeel("قال الشيخ", "قَالَ لَنَا الشَّيْخُ");
    expect(out.text).toBe("قَالَ الشَّيْخُ");
  });

  it("يحفظ الترقيم والمسافات كما في الأصل", () => {
    const out = guardTashkeel("نعم، صحيح.", "نَعَمْ، صَحِيحٌ.");
    expect(out.text).toBe("نَعَمْ، صَحِيحٌ.");
  });
});
