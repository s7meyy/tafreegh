import { getRedis } from "./redis";

/**
 * حدّ المحاولات الفاشلة.
 *
 * يُحصى الفشل وحده: احتساب الدخول الناجح كان يحجب مستخدمًا شرعيًا
 * يدخل ويخرج كثيرًا. ويُحصى على مفتاحين معًا — العنوان والحساب —
 * فتخمين كلمة مرور حساب بعينه يُحجب ولو تنقّل المهاجم بين العناوين،
 * والعنوان الواحد لا يجرّب حسابات كثيرة.
 *
 * النافذة ثابتة، فتسمح بضعف الحدّ على حدود النافذتين؛ مقبول هنا:
 * الغرض إبطاء التخمين لا منعه بدقة رياضية.
 */

function bucketKey(key: string, windowSec: number): string {
  const bucket = Math.floor(Date.now() / (windowSec * 1000));
  return `ratelimit:${key}:${bucket}`;
}

/** هل تجاوز أيٌّ من المفاتيح الحدّ؟ قراءة فقط، لا تستهلك محاولة. */
export async function isBlocked(
  keys: readonly string[],
  limit: number,
  windowSec: number,
): Promise<{ blocked: boolean; retryAfterMs: number }> {
  const redis = getRedis();
  const names = keys.map((k) => bucketKey(k, windowSec));
  const counts = await redis.mget(names);

  const over = counts.findIndex((c) => Number(c ?? 0) >= limit);
  if (over === -1) return { blocked: false, retryAfterMs: 0 };

  const pttl = await redis.pttl(names[over]!);
  return { blocked: true, retryAfterMs: pttl > 0 ? pttl : windowSec * 1000 };
}

/** تسجيل محاولة فاشلة على كل المفاتيح. */
export async function recordFailure(
  keys: readonly string[],
  windowSec: number,
): Promise<void> {
  const pipe = getRedis().pipeline();
  for (const key of keys) {
    const name = bucketKey(key, windowSec);
    pipe.incr(name);
    pipe.expire(name, windowSec);
  }
  await pipe.exec();
}

/**
 * مُعرِّف الطالب.
 *
 * خلف وكيل عكسي يكون عنوان الاتصال عنوانَ الوكيل للجميع، فنقرأ
 * `x-forwarded-for`. وهي ترويسة يزوّرها العميل، فلا تصلح إلا خلف وكيل
 * يعيد كتابتها — وهو الوضع الموصى به في دليل النشر. ولأن الحساب يُحصى
 * أيضًا، فتزوير العنوان لا يفتح باب التخمين على حساب بعينه.
 */
export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first || request.headers.get("x-real-ip") || "unknown";
}
