import { db } from "@/db";
import { usage } from "@/db/schema";
import { reserve } from "@/lib/quota";
import type { TranscriptResult } from "@/lib/transcript/types";
import { GeminiProvider } from "./gemini";
import { GroqProvider } from "./groq";
import { ProviderError, type TranscribeInput, type TranscriptionProvider } from "./types";

/** خطأ يعني: الحصة نفدت، أجّل المهمة ولا تعدّها فاشلة. */
export class QuotaExhaustedError extends Error {
  constructor(
    readonly provider: string,
    readonly retryAfterMs: number,
  ) {
    super(`نفدت حصة ${provider}؛ تُعاد المحاولة بعد ${Math.ceil(retryAfterMs / 1000)} ثانية`);
    this.name = "QuotaExhaustedError";
  }
}

export function transcriptionProviders(): TranscriptionProvider[] {
  return [new GroqProvider(), new GeminiProvider()];
}

/**
 * المحرّكات المتاحة لمشروع، بحسب ملف تشغيله.
 * في وضع «مشروع خاص» لا يُسمح بأي محرّك يُخرج الصوت من الخادم.
 */
export function providersFor(profile: "free_cloud" | "local_only") {
  const all = transcriptionProviders().filter((p) => p.isConfigured());
  return profile === "local_only" ? all.filter((p) => !p.isRemote) : all;
}

/**
 * نداء محرّك واحد مع حجز الحصة وتسجيل الاستهلاك.
 *
 * ترتيب مقصود: الحجز قبل النداء، والارتداد عند الفشل. لو حُجز بعد
 * النداء لتجاوزت عدة مهام متزامنة الحدّ قبل أن يظهر أثر أولها.
 */
export async function runProvider(
  provider: TranscriptionProvider,
  input: TranscribeInput,
  itemId?: string,
): Promise<TranscriptResult> {
  const quotaKey = provider.name;
  const decision = await reserve(quotaKey, {
    requests: 1,
    audioSeconds: Math.ceil(input.audioSeconds),
  });

  if (!decision.ok) {
    throw new QuotaExhaustedError(quotaKey, decision.retryAfterMs);
  }

  const startedAt = Date.now();
  try {
    const result = await provider.transcribe(input);
    await recordUsage(provider, input, itemId, Date.now() - startedAt, true);
    return result;
  } catch (err) {
    // 429 يعني أن حسابنا للحصة متأخّر عن حساب المزوّد: لا نرتدّ،
    // بل نترك العدّاد مرتفعًا حتى تُغلق النافذة.
    const rateLimited = err instanceof ProviderError && err.options.status === 429;
    if (!rateLimited) await decision.release();

    await recordUsage(provider, input, itemId, Date.now() - startedAt, false);
    throw err;
  }
}

/**
 * تجربة المحرّكات بالترتيب حتى ينجح أحدها.
 * تُستعمل للتنازل حين تنفد حصة مزوّد (§3.3)، لا لتشغيل المحرّكين معًا —
 * ذاك يفعله العامل صراحةً لأنه يريد المخرجين كليهما.
 */
export async function transcribeWithFallback(
  providers: readonly TranscriptionProvider[],
  input: TranscribeInput,
  itemId?: string,
): Promise<TranscriptResult> {
  const failures: string[] = [];

  for (const provider of providers) {
    try {
      return await runProvider(provider, input, itemId);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      failures.push(`${provider.name}: ${reason}`);

      const fatal =
        err instanceof ProviderError && !err.options.retryable && err.options.status
          ? err.options.status >= 400 && err.options.status < 500 && err.options.status !== 429
          : false;
      // خطأ في الطلب نفسه سيتكرر مع كل محرّك — لا معنى للتنازل.
      if (fatal && providers.length > 1) continue;
    }
  }

  throw new Error(`تعذّر التفريغ بكل المحرّكات المتاحة.\n${failures.join("\n")}`);
}

async function recordUsage(
  provider: TranscriptionProvider,
  input: TranscribeInput,
  itemId: string | undefined,
  latencyMs: number,
  ok: boolean,
): Promise<void> {
  await db
    .insert(usage)
    .values({
      itemId: itemId ?? null,
      provider: provider.name,
      model: provider.model,
      requests: 1,
      audioSeconds: Math.ceil(input.audioSeconds),
      latencyMs,
      ok,
    })
    .catch(() => {
      // تسجيل الاستهلاك تشخيصي: فشله لا يُسقط مهمة تفريغ ناجحة.
    });
}
