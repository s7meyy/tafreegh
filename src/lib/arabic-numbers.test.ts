import { describe, expect, it } from "vitest";
import { arabicNumberValue, sameNumber } from "./arabic-numbers";

describe("arabicNumberValue", () => {
  it.each([
    ["20", 20],
    ["٣٠٠", 300],
    ["عشرين", 20],
    ["ثلاثمية", 300],
    ["مية", 100],
    ["ألف", 1000],
    ["ألفين", 2000],
    ["ثلاثة آلاف", 3000],
    ["خمسة وعشرين", 25],
    ["مية وخمسين", 150],
    ["خمسطعش", 15],
    ["ثلاث عشرة", 13],
    ["ألف وخمسمية", 1500],
  ])("«%s» = %d", (text, value) => {
    expect(arabicNumberValue(text)).toBe(value);
  });

  it("يعيد null لما ليس عددًا", () => {
    expect(arabicNumberValue("نخلة")).toBeNull();
    expect(arabicNumberValue("عشرين نخلة")).toBeNull();
    expect(arabicNumberValue("")).toBeNull();
  });
});

describe("sameNumber", () => {
  it("يسوّي بين الكتابتين", () => {
    expect(sameNumber("عشرين", "20")).toBe(true);
    expect(sameNumber("ثمان", "8")).toBe(true);
  });

  it("يفرّق بين عددين مختلفين", () => {
    expect(sameNumber("عشرين", "30")).toBe(false);
  });
});
