/**
 * أخطاء مشتركة.
 *
 * مفصولة عن `providers/registry` عمدًا: ذاك يستورد قاعدة البيانات
 * لتسجيل الاستهلاك، فلو سكن الخطأُ فيه لجرّ كلُّ من يمسكه اتصالَ
 * قاعدة بيانات لا يحتاجه — ومنهم أداة القياس والاختبارات.
 */

/** الحصة نفدت: أجّل المهمة ولا تعدّها فاشلة (§3.3). */
export class QuotaExhaustedError extends Error {
  constructor(
    readonly provider: string,
    readonly retryAfterMs: number,
  ) {
    super(
      `نفدت حصة ${provider}؛ تُعاد المحاولة بعد ${Math.ceil(retryAfterMs / 1000)} ثانية`,
    );
    this.name = "QuotaExhaustedError";
  }
}
