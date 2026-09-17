import { env } from "@/lib/env";
import { QuotaExhaustedError } from "@/lib/errors";
import { toProviderError } from "@/lib/providers/groq";
import { ProviderError } from "@/lib/providers/types";
import { reserve } from "@/lib/quota";

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

/**
 * مزوّد المراجعة النصية.
 *
 * مخرَج مبنيّ (JSON Schema) لا نصّ حر: كل تعديل كائن له موضع وسبب،
 * فيمكن التحقق منه آليًا ورفضه إن لم يُستوفَ. النصّ الحر يجعل الحارس
 * في `applyEdits` بلا مادة يعمل عليها.
 */

export type ReviewTier = "review" | "audit";

export interface ReviewCall<T> {
  tier: ReviewTier;
  system: string;
  user: string;
  /** مخطط JSON الذي يلتزم به المخرَج */
  schema: Record<string, unknown>;
  parse: (value: unknown) => T;
  /** وضع «مشروع خاص»: لا يخرج النصّ من الخادم */
  local?: boolean;
}

function modelFor(tier: ReviewTier): { model: string; quotaKey: string } {
  const e = env();
  return tier === "audit"
    ? { model: e.GEMINI_AUDIT_MODEL, quotaKey: "gemini-pro" }
    : { model: e.GEMINI_REVIEW_MODEL, quotaKey: "gemini" };
}

export function isReviewConfigured(local = false): boolean {
  return local ? Boolean(env().OLLAMA_BASE_URL) : Boolean(env().GEMINI_API_KEY);
}

export async function callReview<T>(call: ReviewCall<T>): Promise<T> {
  if (call.local) return callOllama(call);

  const apiKey = env().GEMINI_API_KEY;
  if (!apiKey) {
    throw new ProviderError("مفتاح GEMINI_API_KEY غير مضبوط", {
      provider: "gemini",
      retryable: false,
    });
  }

  const { model, quotaKey } = modelFor(call.tier);

  // الحدّ المجاني على **عدد الطلبات** لا على الرموز، فالحجز بالطلب.
  const decision = await reserve(quotaKey, { requests: 1 });
  if (!decision.ok) {
    throw new QuotaExhaustedError(quotaKey, decision.retryAfterMs);
  }

  try {
    const res = await fetch(`${BASE}/${model}:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: call.system }] },
        contents: [{ role: "user", parts: [{ text: call.user }] }],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: "application/json",
          responseSchema: call.schema,
        },
      }),
    });

    if (!res.ok) {
      const err = await toProviderError(res, quotaKey);
      if (err.options.status !== 429) await decision.release();
      throw err;
    }

    const body = (await res.json()) as GeminiJsonResponse;
    const raw = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("");

    if (!raw?.trim()) {
      throw new ProviderError("لم يُعد النموذج مخرَجًا", {
        provider: quotaKey,
        retryable: true,
      });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // المخرَج المبنيّ يمنع هذا عادةً، لكن القطع عند حدّ الرموز يكسر JSON.
      throw new ProviderError(`مخرَج غير صالح من ${quotaKey}`, {
        provider: quotaKey,
        retryable: true,
      });
    }

    return call.parse(parsed);
  } catch (err) {
    if (!(err instanceof ProviderError)) await decision.release();
    throw err;
  }
}

/**
 * المراجعة المحلية عبر Ollama — نظير `LocalWhisperProvider` في النصّ.
 * بلا حصة تُحجز: المورد هنا معالجك لا سياسة مزوّد.
 */
async function callOllama<T>(call: ReviewCall<T>): Promise<T> {
  const { OLLAMA_BASE_URL: base, OLLAMA_MODEL: model } = env();

  let res: Response;
  try {
    res = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        format: call.schema,
        options: { temperature: 0.2 },
        messages: [
          { role: "system", content: call.system },
          { role: "user", content: call.user },
        ],
      }),
    });
  } catch {
    throw new ProviderError(
      `تعذّر الاتصال بـ Ollama على ${base}. شغّله أو أطفئ وضع «مشروع خاص».`,
      { provider: "ollama", retryable: true },
    );
  }

  if (!res.ok) throw await toProviderError(res, "ollama");

  const body = (await res.json()) as { message?: { content?: string } };
  const raw = body.message?.content;

  if (!raw?.trim()) {
    throw new ProviderError("لم يُعد Ollama مخرَجًا", {
      provider: "ollama",
      retryable: true,
    });
  }

  try {
    return call.parse(JSON.parse(raw));
  } catch {
    // النماذج المحلية أضعف التزامًا بالمخطط من المزوّدين الكبار.
    throw new ProviderError(
      `مخرَج غير صالح من ${model}. جرّب نموذجًا أكبر في OLLAMA_MODEL.`,
      { provider: "ollama", retryable: true },
    );
  }
}

interface GeminiJsonResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
}
