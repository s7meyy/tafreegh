import { describe, expect, it } from "vitest";
import { cleanTitle, isGenericTitle } from "./title";

describe("isGenericTitle", () => {
  it.each(["interview", "REC_0012", "Recording (3)", "20260926_101500", "WhatsApp Audio 2026-09-01", "تسجيل جديد 4", "audio"])(
    "«%s» اسم عام",
    (t) => expect(isGenericTitle(t)).toBe(true),
  );

  it.each(["محاضرة الافتتاح", "لقاء مع الشيخ", "interview with Ahmad"])("«%s» اسم دالّ", (t) =>
    expect(isGenericTitle(t)).toBe(false),
  );
});

describe("cleanTitle", () => {
  it("ينزع علامات التنصيص والنقطة", () => {
    expect(cleanTitle("«مقابلة مع مزارع.»")).toBe("مقابلة مع مزارع");
  });

  it("يرفض عنوانًا من كلمة واحدة", () => {
    expect(cleanTitle("مقابلة")).toBeNull();
  });
});
