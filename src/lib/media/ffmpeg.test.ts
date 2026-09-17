import { describe, expect, it } from "vitest";
import { parseSilence } from "./ffmpeg";

describe("parseSilence", () => {
  const sample = `
[silencedetect @ 0x55] silence_start: 12.4
[silencedetect @ 0x55] silence_end: 13.9 | silence_duration: 1.5
[silencedetect @ 0x55] silence_start: 61.02
[silencedetect @ 0x55] silence_end: 62.5 | silence_duration: 1.48
`;

  it("يقرأ أزواج البداية والنهاية ويحوّلها إلى مللي ثانية", () => {
    expect(parseSilence(sample)).toEqual([
      { startMs: 12_400, endMs: 13_900 },
      { startMs: 61_020, endMs: 62_500 },
    ]);
  });

  it("يتجاهل بداية بلا نهاية — يقع حين ينتهي الملف بصمت", () => {
    const partial = `${sample}[silencedetect @ 0x55] silence_start: 90.0\n`;
    expect(parseSilence(partial)).toHaveLength(2);
  });

  it("يتجاهل نهاية بلا بداية", () => {
    expect(parseSilence("silence_end: 5.0 | silence_duration: 1.0")).toEqual([]);
  });

  it("يعيد قائمة فارغة لمخرجات لا صمت فيها", () => {
    expect(parseSilence("size=N/A time=00:10:00.00 bitrate=N/A")).toEqual([]);
  });

  it("يصحّح البداية السالبة إلى صفر", () => {
    const negative = "silence_start: -0.001\nsilence_end: 0.6 | silence_duration: 0.6";
    expect(parseSilence(negative)).toEqual([{ startMs: 0, endMs: 600 }]);
  });

  it("يتجاهل فترة نهايتها قبل بدايتها", () => {
    expect(parseSilence("silence_start: 10.0\nsilence_end: 9.0")).toEqual([]);
  });
});
