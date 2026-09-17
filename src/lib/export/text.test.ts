import { describe, expect, it } from "vitest";
import { safeFilename, toMarkdown, toTxt, type ExportMeta } from "./text";

const meta: ExportMeta = {
  title: "محاضرة الافتتاح",
  project: "محاضرات الفصل الأول",
  mode: "clean",
  durationSec: 3720,
  approvedAt: new Date("2026-09-17T10:00:00Z"),
};

const text = "الفقرة الأولى.\n\nالفقرة الثانية.";

describe("toTxt", () => {
  it("يبدأ بالتفريغ لا بالبيانات", () => {
    expect(toTxt(text, meta).startsWith("الفقرة الأولى.")).toBe(true);
  });

  it("يضع البيانات في الذيل", () => {
    const out = toTxt(text, meta);
    expect(out).toContain("المجلد: محاضرات الفصل الأول");
    expect(out).toContain("نمط التفريغ: منقّح");
    // المثنّى في العربية بلا عدد: «دقيقتان» لا «2 دقيقتان»
    expect(out).toContain("ساعة ودقيقتان");
  });

  it("يسقط المدة حين تكون غائبة", () => {
    const out = toTxt(text, { ...meta, durationSec: null, approvedAt: null });
    expect(out).not.toContain("المدة:");
    expect(out).not.toContain("اعتُمد");
  });
});

describe("toMarkdown", () => {
  it("يضع العنوان ترويسة والبيانات قائمة", () => {
    const out = toMarkdown(text, meta);
    expect(out.startsWith("# محاضرة الافتتاح")).toBe(true);
    expect(out).toContain("- المجلد: محاضرات الفصل الأول");
  });

  it("يفصل الفقرات بسطر فارغ", () => {
    expect(toMarkdown(text, meta)).toContain("الفقرة الأولى.\n\nالفقرة الثانية.");
  });

  it("يتجاهل الفقرات الفارغة", () => {
    const out = toMarkdown("أولى\n\n\n\n\nثانية", meta);
    expect(out).not.toMatch(/\n\n\n\n/);
  });
});

describe("safeFilename", () => {
  it("يحفظ العربية والمسافات", () => {
    expect(safeFilename("محاضرة الافتتاح", "txt")).toBe("محاضرة الافتتاح.txt");
  });

  it("يسقط الرموز التي تكسر أنظمة الملفات", () => {
    expect(safeFilename('تقرير/2026: "الأول"', "md")).toBe("تقرير2026 الأول.md");
  });

  it("يعطي اسمًا افتراضيًا لعنوان فارغ", () => {
    expect(safeFilename("   ", "docx")).toBe("تفريغ.docx");
    expect(safeFilename("///", "docx")).toBe("تفريغ.docx");
  });

  it("يقصّ العنوان الطويل", () => {
    const long = "ط".repeat(200);
    expect(safeFilename(long, "txt").length).toBeLessThanOrEqual(85);
  });
});
