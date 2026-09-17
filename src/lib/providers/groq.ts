import { env } from "@/lib/env";
import type { TranscriptResult, Word } from "@/lib/transcript/types";
import { ProviderError, type TranscribeInput, type TranscriptionProvider } from "./types";

const ENDPOINT = "https://api.groq.com/openai/v1/audio/transcriptions";

/**
 * Groq — المحرّك الأول. طبقة مجانية سخية (‏8 ساعات صوت يوميًا)
 * ويعيد توقيتات الكلمات و`avg_logprob` لكل مقطع، وهو مصدر درجات
 * الثقة التي تبني عليها المراجعة (§2.1).
 */
export class GroqProvider implements TranscriptionProvider {
  readonly name = "groq";
  readonly isRemote = true;
  readonly model: string;

  constructor(private readonly apiKey = env().GROQ_API_KEY) {
    this.model = env().GROQ_ASR_MODEL;
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  async transcribe(input: TranscribeInput): Promise<TranscriptResult> {
    if (!this.apiKey) {
      throw new ProviderError("مفتاح GROQ_API_KEY غير مضبوط", {
        provider: this.name,
        retryable: false,
      });
    }

    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(input.audio)]), input.filename);
    form.append("model", this.model);
    form.append("language", input.languageHint ?? "ar");
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "word");
    form.append("timestamp_granularities[]", "segment");
    form.append("temperature", "0");
    if (input.glossary?.length) {
      // التلقين يرفع دقة أسماء الأعلام كثيرًا، وهو مجاني هنا.
      form.append("prompt", input.glossary.join("، "));
    }

    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}` },
      body: form,
    });

    if (!res.ok) throw await toProviderError(res, this.name);

    const body = (await res.json()) as GroqResponse;
    return this.toResult(body, input.audioSeconds);
  }

  private toResult(body: GroqResponse, audioSeconds: number): TranscriptResult {
    // الثقة تأتي على مستوى المقطع لا الكلمة، فنسقطها على كلماته.
    const confidenceAt = buildConfidenceLookup(body.segments ?? []);

    const words: Word[] = (body.words ?? []).map((w) => ({
      text: w.word,
      startMs: Math.round(w.start * 1000),
      endMs: Math.round(w.end * 1000),
      confidence: confidenceAt(w.start),
    }));

    const scored = words.filter((w) => w.confidence !== undefined);
    const avgConfidence =
      scored.length > 0
        ? scored.reduce((s, w) => s + w.confidence!, 0) / scored.length
        : undefined;

    return {
      text: (body.text ?? "").trim(),
      words,
      avgConfidence,
      engine: this.name,
      model: this.model,
      audioSeconds,
    };
  }
}

/**
 * `avg_logprob` احتمال لوغاريتمي (‏≤ 0). نحوّله إلى ‏0..1 بالأسّ،
 * فيصير مقارنًا بدرجات الثقة من محرّكات أخرى.
 */
function buildConfidenceLookup(
  segments: readonly GroqSegment[],
): (startSec: number) => number | undefined {
  if (segments.length === 0) return () => undefined;

  return (startSec) => {
    const seg = segments.find((s) => startSec >= s.start && startSec <= s.end);
    if (!seg || seg.avg_logprob === undefined) return undefined;
    return Math.min(1, Math.exp(seg.avg_logprob));
  };
}

export async function toProviderError(
  res: Response,
  provider: string,
): Promise<ProviderError> {
  const text = await res.text().catch(() => "");
  const retryAfter = Number(res.headers.get("retry-after")) * 1000;

  return new ProviderError(
    `فشل نداء ${provider} (${res.status}): ${text.slice(0, 300)}`,
    {
      provider,
      status: res.status,
      // 429 وأخطاء الخادم تُعاد؛ 4xx الأخرى خطأ في الطلب لا يُصلحه التكرار.
      retryable: res.status === 429 || res.status >= 500,
      retryAfterMs: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
    },
  );
}

interface GroqSegment {
  start: number;
  end: number;
  avg_logprob?: number;
}

interface GroqResponse {
  text?: string;
  words?: { word: string; start: number; end: number }[];
  segments?: GroqSegment[];
}
