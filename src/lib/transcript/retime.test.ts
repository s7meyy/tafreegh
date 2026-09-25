import { describe, expect, it } from "vitest";
import { retime } from "./retime";
import type { Word } from "./types";

function words(text: string): Word[] {
  return text.split(" ").map((t, i) => ({ text: t, startMs: i * 1000, endMs: i * 1000 + 800 }));
}

describe("retime", () => {
  it("يحفظ التوقيت حين يتطابق النصّان", () => {
    const out = retime("واحد اثنان ثلاثة", words("واحد اثنان ثلاثة"));
    expect(out.map((w) => w.startMs)).toEqual([0, 1000, 2000]);
  });

  it("يأخذ نصّ المعتمد لا الخام", () => {
    const out = retime("أمس رحنا", words("امس رحنا"));
    expect(out.map((w) => w.text)).toEqual(["أمس", "رحنا"]);
    expect(out[0]!.startMs).toBe(0);
  });

  it("يوزّع مدى الكلمة المستبدلة على بديلها", () => {
    const out = retime("قال عبدالله أمس", words("قال عبد الله أمس"));
    expect(out.map((w) => w.text)).toEqual(["قال", "عبدالله", "أمس"]);
    expect(out[1]!.startMs).toBe(1000);
    expect(out[1]!.endMs).toBe(2800);
    expect(out[2]!.startMs).toBe(3000);
  });

  it("يسقط ما حذفه المراجع", () => {
    const out = retime("الجو بارد", words("الجو يعني يعني بارد"));
    expect(out.map((w) => w.text)).toEqual(["الجو", "بارد"]);
    expect(out[1]!.startMs).toBe(3000);
  });

  it("يبقي إضافة المستخدم في آخر النصّ", () => {
    const out = retime("واحد اثنان سطر مضاف", words("واحد اثنان"));
    expect(out.map((w) => w.text)).toEqual(["واحد", "اثنان", "سطر", "مضاف"]);
  });

  it("يعيد قائمة فارغة بلا توقيتات", () => {
    expect(retime("نص", [])).toEqual([]);
  });
});
