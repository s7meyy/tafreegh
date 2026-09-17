import { getRedis } from "./redis";

/**
 * حدّ محاولات بسيط بنافذة ثابتة.
 *
 * يخصّ المحاولات التي يجرّبها الغرباء — الدخول قبل كل شيء. بلا حدّ،
 * كلمة المرور مهما طالت تسقط أمام آلة تجرّب بلا كلل.
 *
 * النافذة الثابتة تسمح بضعف الحدّ على حدود النافذتين، وهذا مقبول هنا:
 * الغرض إبطاء التخمين لا منعه بدقة رياضية.
 */
export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterMs: number;
}

export async function rateLimit(
  key: string,
  limit: number,
  windowSec: number,
): Promise<RateLimitResult> {
  const redis = getRedis();
  const bucket = Math.floor(Date.now() / (windowSec * 1000));
  const redisKey = `ratelimit:${key}:${bucket}`;

  const count = await redis.incr(redisKey);
  if (count === 1) await redis.expire(redisKey, windowSec);

  const pttl = await redis.pttl(redisKey);

  return {
    ok: count <= limit,
    remaining: Math.max(0, limit - count),
    retryAfterMs: pttl > 0 ? pttl : windowSec * 1000,
  };
}

/**
 * مُعرِّف الطالب.
 *
 * خلف وكيل عكسي يكون `request.ip` عنوانَ الوكيل نفسه للجميع، فنقرأ
 * `x-forwarded-for`. وهي ترويسة يزوّرها العميل، فلا تصلح إلا خلف وكيل
 * يُعيد كتابتها — وهو الوضع الموصى به في دليل النشر.
 */
export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first || request.headers.get("x-real-ip") || "unknown";
}
