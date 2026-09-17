import type { TranscriptResult } from "@/lib/transcript/types";

export interface TranscribeInput {
  /** محتوى المقطع الفرعي — WAV ‏16kHz أحادي بعد التطبيع */
  audio: Buffer;
  filename: string;
  audioSeconds: number;
  /** مصطلحات المشروع — تُمرَّر تلقينًا للمحرّك لتحسين أسماء الأعلام */
  glossary?: string[];
  languageHint?: string;
}

export interface TranscriptionProvider {
  /** المعرّف المستعمل في جداول الحصص والاستهلاك */
  readonly name: string;
  readonly model: string;
  /** هل المفاتيح متوفّرة؟ مزوّد غير مهيّأ يُتخطّى بلا خطأ */
  isConfigured(): boolean;
  /** هل يغادر الصوت الخادم؟ يُستعمل لفرض وضع «مشروع خاص» */
  readonly isRemote: boolean;
  transcribe(input: TranscribeInput): Promise<TranscriptResult>;
}

/** خطأ يعرف صاحبه إن كانت إعادة المحاولة مجدية. */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly options: {
      provider: string;
      retryable: boolean;
      /** من ترويسة Retry-After حين يرسلها المزوّد */
      retryAfterMs?: number;
      status?: number;
    },
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
