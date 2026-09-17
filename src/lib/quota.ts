import type Redis from "ioredis";
import { getRedis } from "./redis";

/**
 * متتبّع الحصص.
 *
 * حين تكون النماذج مجانية، المورد النادر ليس المال بل الحصة. فيُحجز
 * المطلوب **قبل** النداء، وترتدّ الحجوزات إن فشل النداء قبل أن يُحتسب
 * عند المزوّد. الحجز ذرّي عبر Lua فلا يتجاوز عاملان الحدّ معًا.
 *
 * حدود المزوّدين تتغيّر باستمرار، فهي هنا بيانات لا منطق، وتُصحَّح
 * من ترويسات `x-ratelimit-*` حين يرسلها المزوّد.
 */

export type QuotaUnit = "requests" | "audioSeconds";

export interface QuotaWindow {
  unit: QuotaUnit;
  /** مدة النافذة بالثواني */
  windowSec: number;
  limit: number;
}

export interface ProviderQuota {
  provider: string;
  windows: QuotaWindow[];
}

/**
 * الحدود المعروفة في سبتمبر ‏2026 (§3.1 من الخطة).
 * راجعها من لوحة المزوّد — تتغيّر، والنظام يتحمّل تغيّرها.
 */
export const QUOTAS: Record<string, ProviderQuota> = {
  groq: {
    provider: "groq",
    windows: [
      { unit: "requests", windowSec: 60, limit: 20 },
      { unit: "requests", windowSec: 86_400, limit: 2_000 },
      { unit: "audioSeconds", windowSec: 3_600, limit: 7_200 },
      { unit: "audioSeconds", windowSec: 86_400, limit: 28_800 },
    ],
  },
  gemini: {
    provider: "gemini",
    windows: [
      { unit: "requests", windowSec: 60, limit: 10 },
      { unit: "requests", windowSec: 86_400, limit: 250 },
    ],
  },
  "gemini-pro": {
    provider: "gemini-pro",
    windows: [
      { unit: "requests", windowSec: 60, limit: 5 },
      { unit: "requests", windowSec: 86_400, limit: 50 },
    ],
  },
  /** محلي — بلا حدود، لكنه يمرّ بالمسار نفسه ليُسجَّل استهلاكه */
  local: { provider: "local", windows: [] },
};

export interface QuotaCost {
  requests?: number;
  audioSeconds?: number;
}

export type QuotaDecision =
  | { ok: true; release: () => Promise<void> }
  | { ok: false; retryAfterMs: number; window: QuotaWindow };

/**
 * يزيد كل عدّاد، وإن تجاوز أحدها حدّه يرجع الجميع ويعيد مدة الانتظار.
 * الرجوع ضروري: بلا ذرّية، طلبٌ مرفوض لنافذة اليوم يترك نافذة الدقيقة
 * منتفخة فتتعطّل بلا سبب.
 */
const RESERVE_LUA = `
local now = tonumber(ARGV[1])
local n = tonumber(ARGV[2])
local applied = {}

for i = 0, n - 1 do
  local key   = KEYS[i + 1]
  local cost  = tonumber(ARGV[3 + i * 3])
  local limit = tonumber(ARGV[4 + i * 3])
  local ttl   = tonumber(ARGV[5 + i * 3])

  if cost > 0 then
    local value = redis.call('INCRBY', key, cost)
    if value == cost then
      redis.call('EXPIRE', key, ttl)
    end
    applied[#applied + 1] = { key, cost }

    if value > limit then
      for _, entry in ipairs(applied) do
        redis.call('DECRBY', entry[1], entry[2])
      end
      local pttl = redis.call('PTTL', key)
      if pttl < 0 then pttl = ttl * 1000 end
      return { 0, i + 1, pttl }
    end
  end
end

return { 1, 0, 0 }
`;

function windowKey(provider: string, w: QuotaWindow, now: number): string {
  const bucket = Math.floor(now / (w.windowSec * 1000));
  return `quota:${provider}:${w.unit}:${w.windowSec}:${bucket}`;
}

export async function reserve(
  provider: string,
  cost: QuotaCost,
  redis: Redis = getRedis(),
): Promise<QuotaDecision> {
  const quota = QUOTAS[provider];
  if (!quota || quota.windows.length === 0) {
    return { ok: true, release: async () => {} };
  }

  const now = Date.now();
  const keys: string[] = [];
  const args: (string | number)[] = [now, quota.windows.length];

  for (const w of quota.windows) {
    keys.push(windowKey(provider, w, now));
    args.push(cost[w.unit] ?? 0, w.limit, w.windowSec);
  }

  const [ok, index, pttl] = (await redis.eval(
    RESERVE_LUA,
    keys.length,
    ...keys,
    ...args,
  )) as [number, number, number];

  if (ok === 1) {
    return {
      ok: true,
      release: async () => {
        // ترتدّ الحجوزات حين يفشل النداء قبل أن يحتسبه المزوّد.
        const pipe = redis.pipeline();
        quota.windows.forEach((w, i) => {
          const amount = cost[w.unit] ?? 0;
          if (amount > 0) pipe.decrby(keys[i]!, amount);
        });
        await pipe.exec();
      },
    };
  }

  return {
    ok: false,
    retryAfterMs: Math.max(1000, pttl),
    window: quota.windows[index - 1]!,
  };
}

export interface QuotaStatus {
  provider: string;
  unit: QuotaUnit;
  windowSec: number;
  limit: number;
  used: number;
  remaining: number;
  resetsInMs: number;
}

/** الحالة الحالية لكل نافذة — مادة لوحة الحصص في الواجهة. */
export async function quotaStatus(
  redis: Redis = getRedis(),
): Promise<QuotaStatus[]> {
  const now = Date.now();
  const entries = Object.values(QUOTAS).flatMap((q) =>
    q.windows.map((w) => ({ provider: q.provider, w, key: windowKey(q.provider, w, now) })),
  );
  if (entries.length === 0) return [];

  const values = await redis.mget(entries.map((e) => e.key));

  return entries.map((e, i) => {
    const used = Number(values[i] ?? 0);
    const elapsed = now % (e.w.windowSec * 1000);
    return {
      provider: e.provider,
      unit: e.w.unit,
      windowSec: e.w.windowSec,
      limit: e.w.limit,
      used,
      remaining: Math.max(0, e.w.limit - used),
      resetsInMs: e.w.windowSec * 1000 - elapsed,
    };
  });
}
