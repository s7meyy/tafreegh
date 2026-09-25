import { describe, expect, it } from "vitest";
import { resumeStage, type ItemFacts } from "./retry";

const base: ItemFacts = {
  sourceType: "upload",
  hasMedia: true,
  mediaDeleted: false,
  hasSegments: true,
  hasTranscript: false,
};

describe("resumeStage", () => {
  it("يستأنف من المراجعة حين يوجد تفريغ — لا يُعاد ما أُنجز", () => {
    expect(resumeStage({ ...base, hasTranscript: true })).toEqual({ ok: true, stage: "review" });
  });

  it("يراجع التفريغ الموجود ولو حُذفت الوسائط", () => {
    expect(
      resumeStage({ ...base, hasTranscript: true, hasMedia: false, mediaDeleted: true }),
    ).toEqual({ ok: true, stage: "review" });
  });

  it("يستأنف من التفريغ حين توجد خطة التقطيع", () => {
    expect(resumeStage(base)).toEqual({ ok: true, stage: "transcribe" });
  });

  it("يستأنف من التحضير حين لا خطة تقطيع", () => {
    expect(resumeStage({ ...base, hasSegments: false })).toEqual({ ok: true, stage: "prepare" });
  });

  it("يعيد جلب رابط يوتيوب لم يُنزَّل", () => {
    expect(resumeStage({ ...base, sourceType: "youtube", hasMedia: false, hasSegments: false })).toEqual({
      ok: true,
      stage: "fetch",
    });
  });

  it("يرفض بسبب واضح حين حُذفت الوسائط ولا تفريغ", () => {
    const d = resumeStage({ ...base, hasMedia: false, mediaDeleted: true });
    expect(d.ok).toBe(false);
  });

  it("يرفض رفعًا بلا ملف", () => {
    expect(resumeStage({ ...base, hasMedia: false }).ok).toBe(false);
  });
});
