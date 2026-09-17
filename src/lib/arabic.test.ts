import { describe, expect, it } from "vitest";
import {
  compareTokens,
  normalizeForCompare,
  tidyOutput,
  wordErrorRate,
} from "./arabic";

describe("normalizeForCompare", () => {
  it("يوحّد صور الألف والياء والتاء المربوطة", () => {
    expect(normalizeForCompare("إبراهيم")).toBe(normalizeForCompare("ابراهيم"));
    expect(normalizeForCompare("مصطفى")).toBe(normalizeForCompare("مصطفي"));
    expect(normalizeForCompare("مكتبة")).toBe(normalizeForCompare("مكتبه"));
  });

  it("يحذف التشكيل والتطويل", () => {
    expect(normalizeForCompare("مُحَمَّد")).toBe("محمد");
    expect(normalizeForCompare("محـــمد")).toBe("محمد");
  });

  it("يحوّل الأرقام العربية الهندية", () => {
    // التاء المربوطة تصير هاءً بالتطبيع — هذا مقصود، والمقارنة وحدها تستعمله
    expect(normalizeForCompare("سنة ١٤٤٥")).toBe("سنه 1445");
  });

  it("يحذف الترقيم ويوحّد المسافات", () => {
    expect(normalizeForCompare("  السلام ،  عليكم!  ")).toBe("السلام عليكم");
  });

  it("يعيد نصًّا فارغًا لمدخل فارغ", () => {
    expect(compareTokens("")).toEqual([]);
    expect(compareTokens("  ،،  ")).toEqual([]);
  });
});

describe("tidyOutput", () => {
  it("يلصق الترقيم بما قبله ويفصله عما بعده", () => {
    expect(tidyOutput("نعم ، وبعد ذلك")).toBe("نعم، وبعد ذلك");
    expect(tidyOutput("نعم،وبعد")).toBe("نعم، وبعد");
  });

  it("يحوّل الترقيم اللاتيني إلى العربي", () => {
    expect(tidyOutput("كيف حالك?")).toBe("كيف حالك؟");
    expect(tidyOutput("أولًا, ثانيًا")).toBe("أولًا، ثانيًا");
  });

  it("لا يغيّر الكلمات نفسها", () => {
    const text = "قال إن الأمر كذا وكذا";
    expect(tidyOutput(text)).toBe(text);
  });

  it("يضغط الأسطر الفارغة المتتالية ولا يمحو فواصل الفقرات", () => {
    expect(tidyOutput("فقرة\n\n\n\nفقرة أخرى")).toBe("فقرة\n\nفقرة أخرى");
  });
});

describe("wordErrorRate", () => {
  it("صفر للنص المطابق", () => {
    expect(wordErrorRate("السلام عليكم ورحمة الله", "السلام عليكم ورحمة الله")).toBe(0);
  });

  it("صفر لاختلاف رسمٍ لا معنى له", () => {
    expect(wordErrorRate("إبراهيم قال هذه", "ابراهيم قال هذة")).toBe(0);
  });

  it("يحسب الإبدال والحذف والإضافة", () => {
    // مرجع من أربع كلمات، خطأ واحد
    expect(wordErrorRate("واحد اثنان ثلاثة أربعة", "واحد اثنان ثلاثة خمسة")).toBeCloseTo(
      0.25,
    );
    expect(wordErrorRate("واحد اثنان ثلاثة أربعة", "واحد اثنان ثلاثة")).toBeCloseTo(0.25);
  });

  it("يعيد 1 حين يكون المرجع فارغًا والفرضية ليست كذلك", () => {
    expect(wordErrorRate("", "كلام")).toBe(1);
    expect(wordErrorRate("", "")).toBe(0);
  });
});
