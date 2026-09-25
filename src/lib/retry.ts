/**
 * من أين تُستأنف معالجة مقطع؟
 *
 * لا من أوله دائمًا: مقطع فشل في المراجعة وقد فُرّغ، إعادته من التفريغ
 * تُنفق حصة على عمل منجَز. فنبدأ من أول مرحلة لم يكتمل ناتجها.
 *
 * دالة خالصة: تأخذ ما يملكه المقطع وتعيد المرحلة، فتُختبر بلا قاعدة.
 */

export type ResumeStage = "fetch" | "prepare" | "transcribe" | "review";

export interface ItemFacts {
  sourceType: "upload" | "youtube";
  hasMedia: boolean;
  mediaDeleted: boolean;
  hasSegments: boolean;
  hasTranscript: boolean;
}

export type ResumeDecision =
  | { ok: true; stage: ResumeStage }
  | { ok: false; reason: string };

export function resumeStage(facts: ItemFacts): ResumeDecision {
  // التفريغ الموجود يكفي للمراجعة ولو حُذفت الوسائط.
  if (facts.hasTranscript) return { ok: true, stage: "review" };

  if (facts.mediaDeleted) {
    return {
      ok: false,
      reason: "حُذفت وسائط هذا المقطع ولا تفريغ له، فلا يمكن إعادته. ارفع الملف من جديد.",
    };
  }

  if (!facts.hasMedia) {
    if (facts.sourceType === "youtube") return { ok: true, stage: "fetch" };
    return { ok: false, reason: "لا ملف لهذا المقطع. ارفعه من جديد." };
  }

  if (!facts.hasSegments) return { ok: true, stage: "prepare" };
  return { ok: true, stage: "transcribe" };
}
