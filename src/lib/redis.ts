import Redis from "ioredis";
import { env } from "./env";

declare global {
  // eslint-disable-next-line no-var
  var __tafreeghRedis: Redis | undefined;
}

/**
 * اتصال Redis مشترك. `maxRetriesPerRequest: null` مطلوب لـ BullMQ،
 * وإلا رمت أوامرُ الحجب خطأً عند إعادة الاتصال.
 */
export function getRedis(): Redis {
  if (!globalThis.__tafreeghRedis) {
    globalThis.__tafreeghRedis = new Redis(env().REDIS_URL, {
      maxRetriesPerRequest: null,
    });
  }
  return globalThis.__tafreeghRedis;
}
