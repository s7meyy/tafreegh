import { createHash } from "node:crypto";

/**
 * الإضافات على النصّ: الملخص والتشكيل.
 *
 * كلٌّ منهما مشتقّ من نصّ بعينه، فيُحفظ معه بصمة ذلك النصّ: إن حرّر
 * المستخدم النصّ أو اعتمده بعد الإنشاء، عُرف أن الإضافة قديمة.
 */

export type EnrichKind = "summary" | "tashkeel";

export type EnrichStatus = "queued" | "running" | "done" | "failed";

interface Base {
  status: EnrichStatus;
  /** بصمة النصّ الذي أُنشئت منه */
  source?: string;
  error?: string;
  at?: string;
}

export interface SummaryPoint {
  text: string;
  /** الفقرات التي يستند إليها، ابتداءً من 1 */
  paras: number[];
  /** توقيت أولها في الصوت */
  startMs?: number | null;
}

export interface SummaryData {
  brief: string;
  points: SummaryPoint[];
  topics: string[];
}

export interface SummaryState extends Base {
  data?: SummaryData;
}

export type TashkeelMode = "full" | "light";

export interface TashkeelState extends Base {
  mode: TashkeelMode;
  /** الفقرات المشكولة حتى الآن — للاستئناف بعد نفاد الحصة */
  done?: string[];
  total?: number;
  /** كلمات أعاد النموذج حروفها مغيّرة، فبقيت بلا تشكيل */
  rejectedWords?: number;
  text?: string;
}

export interface Enrichment {
  summary?: SummaryState;
  tashkeel?: TashkeelState;
}

export function fingerprint(text: string): string {
  return createHash("sha256").update(text.trim()).digest("hex").slice(0, 16);
}
