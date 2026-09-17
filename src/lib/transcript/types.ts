/** كلمة واحدة بتوقيتها — أساس التنقّل الصوتي والتصدير إلى srt/vtt. */
export interface Word {
  text: string;
  startMs: number;
  endMs: number;
  /** 0..1 — يوفّرها Groq؛ Gemini لا يوفّرها */
  confidence?: number;
  speaker?: string;
}

/** مخرج محرّك تفريغ واحد لمقطع واحد. */
export interface TranscriptResult {
  text: string;
  words: Word[];
  /** متوسط ثقة الكلمات، إن وفّرها المحرّك */
  avgConfidence?: number;
  engine: string;
  model: string;
  audioSeconds: number;
}

/** خطة تقطيع مقطع واحد — تُبنى من كشف الصمت (§2.3). */
export interface SegmentPlan {
  index: number;
  startMs: number;
  endMs: number;
  /** التداخل مع المقطع السابق، بالمللي ثانية */
  overlapMs: number;
}
