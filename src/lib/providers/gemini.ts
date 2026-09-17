import { env } from "@/lib/env";
import type { TranscriptResult, Word } from "@/lib/transcript/types";
import { toProviderError } from "./groq";
import { ProviderError, type TranscribeInput, type TranscriptionProvider } from "./types";

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

/**
 * Gemini — المحرّك الثاني. أضعف في التوقيتات وأقوى في اللهجات والرسم
 * العربي من Whisper. وجوده ليس ترفًا: اختلافه عن Groq هو الدليل الذي
 * تبني عليه المراجعة تصحيحاتها (§2.1).
 *
 * لا يعطي درجات ثقة، ولا توقيتات موثوقة لكل كلمة. فنوزّع التوقيت على
 * الكلمات توزيعًا منتظمًا داخل المقطع: يكفي للمحاذاة مع Groq، ولا
 * يُعتمد عليه في التصدير — توقيتات Groq هي المرجع هناك.
 */
export class GeminiProvider implements TranscriptionProvider {
  readonly name = "gemini";
  readonly isRemote = true;
  readonly model: string;

  constructor(private readonly apiKey = env().GEMINI_API_KEY) {
    this.model = env().GEMINI_ASR_MODEL;
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  async transcribe(input: TranscribeInput): Promise<TranscriptResult> {
    if (!this.apiKey) {
      throw new ProviderError("مفتاح GEMINI_API_KEY غير مضبوط", {
        provider: this.name,
        retryable: false,
      });
    }

    const res = await fetch(
      `${BASE}/${this.model}:generateContent?key=${this.apiKey}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                { text: buildPrompt(input.glossary) },
                {
                  inline_data: {
                    mime_type: "audio/wav",
                    data: input.audio.toString("base64"),
                  },
                },
              ],
            },
          ],
          generationConfig: { temperature: 0, responseMimeType: "text/plain" },
        }),
      },
    );

    if (!res.ok) throw await toProviderError(res, this.name);

    const body = (await res.json()) as GeminiResponse;

    // الحجب أو القطع يعيد ‏200 بمحتوى فارغ — فحصٌ صريح أوضح من
    // انهيار لاحق بنصّ فارغ.
    const candidate = body.candidates?.[0];
    const text = candidate?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    if (!text.trim()) {
      throw new ProviderError(
        `لم يُعد ${this.name} نصًّا (السبب: ${candidate?.finishReason ?? "غير معروف"})`,
        { provider: this.name, retryable: candidate?.finishReason === "MAX_TOKENS" },
      );
    }

    return {
      text: text.trim(),
      words: spreadWords(text.trim(), input.audioSeconds),
      engine: this.name,
      model: this.model,
      audioSeconds: input.audioSeconds,
    };
  }
}

function buildPrompt(glossary?: string[]): string {
  const lines = [
    "فرّغ هذا المقطع الصوتي العربي حرفيًا.",
    "",
    "قواعد ملزمة:",
    "- اكتب ما سمعته فقط. لا تلخّص ولا تشرح ولا تعلّق.",
    "- أبقِ الألفاظ العامية كما نُطقت. لا تحوّلها إلى فصحى.",
    "- لا تخترع كلامًا للمقاطع غير الواضحة؛ اكتب مكانها [غير واضح].",
    "- استعمل الترقيم العربي: ، ؛ ؟",
    "- أخرج النصّ وحده بلا أي مقدمة ولا عناوين ولا علامات تنسيق.",
  ];

  if (glossary?.length) {
    lines.push(
      "",
      "أسماء ومصطلحات ترد في المقطع، اكتبها بهذا الرسم بالضبط:",
      glossary.map((t) => `- ${t}`).join("\n"),
    );
  }

  return lines.join("\n");
}

/**
 * توزيع التوقيت على الكلمات بالتناسب مع طولها.
 * تقريب مقصود: دوره المحاذاة مع المحرّك الأول لا التوقيت الدقيق.
 */
function spreadWords(text: string, audioSeconds: number): Word[] {
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];

  const totalMs = Math.max(1, Math.round(audioSeconds * 1000));
  const totalChars = tokens.reduce((s, t) => s + t.length, 0);

  let cursor = 0;
  return tokens.map((token) => {
    const share = Math.round((token.length / totalChars) * totalMs);
    const startMs = cursor;
    cursor = Math.min(totalMs, cursor + share);
    return { text: token, startMs, endMs: cursor };
  });
}

interface GeminiResponse {
  candidates?: {
    content?: { parts?: { text?: string }[] };
    finishReason?: string;
  }[];
}
