import type { Word } from "@/lib/transcript/types";

/**
 * تصدير بطاقات الترجمة.
 *
 * إضافة شبه مجانية: التوقيتات محفوظة أصلًا من مرحلة التفريغ، فلا يكلّف
 * إخراج srt/vtt إلا التجميع.
 */

export interface CueOptions {
  /** أقصى عدد كلمات في البطاقة */
  maxWords?: number;
  /** أقصى مدة للبطاقة بالمللي ثانية */
  maxMs?: number;
  /** فجوة صمت تقطع البطاقة ولو لم تمتلئ */
  gapMs?: number;
}

const DEFAULTS: Required<CueOptions> = {
  maxWords: 8,
  maxMs: 6_000,
  gapMs: 700,
};

export interface Cue {
  index: number;
  startMs: number;
  endMs: number;
  text: string;
}

export function buildCues(words: readonly Word[], options: CueOptions = {}): Cue[] {
  const o = { ...DEFAULTS, ...options };
  const cues: Cue[] = [];

  let current: Word[] = [];

  const flush = () => {
    if (current.length === 0) return;
    cues.push({
      index: cues.length + 1,
      startMs: current[0]!.startMs,
      endMs: current[current.length - 1]!.endMs,
      text: current.map((w) => w.text.trim()).filter(Boolean).join(" "),
    });
    current = [];
  };

  for (const word of words) {
    if (!word.text.trim()) continue;

    if (current.length > 0) {
      const first = current[0]!;
      const previous = current[current.length - 1]!;
      const tooLong = word.endMs - first.startMs > o.maxMs;
      const tooMany = current.length >= o.maxWords;
      // الوقفة الطويلة حدّ طبيعي للبطاقة، أوضح من عدّ الكلمات وحده.
      const afterPause = word.startMs - previous.endMs >= o.gapMs;

      if (tooLong || tooMany || afterPause) flush();
    }
    current.push(word);
  }
  flush();

  return cues;
}

export function toSrt(words: readonly Word[], options?: CueOptions): string {
  return buildCues(words, options)
    .map(
      (cue) =>
        `${cue.index}\n${srtTime(cue.startMs)} --> ${srtTime(cue.endMs)}\n${cue.text}\n`,
    )
    .join("\n");
}

export function toVtt(words: readonly Word[], options?: CueOptions): string {
  const cues = buildCues(words, options)
    .map((cue) => `${vttTime(cue.startMs)} --> ${vttTime(cue.endMs)}\n${cue.text}\n`)
    .join("\n");
  return `WEBVTT\n\n${cues}`;
}

function clock(ms: number): { h: string; m: string; s: string; msec: string } {
  const safe = Math.max(0, Math.round(ms));
  return {
    h: String(Math.floor(safe / 3_600_000)).padStart(2, "0"),
    m: String(Math.floor((safe % 3_600_000) / 60_000)).padStart(2, "0"),
    s: String(Math.floor((safe % 60_000) / 1000)).padStart(2, "0"),
    msec: String(safe % 1000).padStart(3, "0"),
  };
}

/** ‏00:01:23,456 — الفاصلة العشرية فاصلةٌ في srt ونقطةٌ في vtt. */
function srtTime(ms: number): string {
  const t = clock(ms);
  return `${t.h}:${t.m}:${t.s},${t.msec}`;
}

function vttTime(ms: number): string {
  const t = clock(ms);
  return `${t.h}:${t.m}:${t.s}.${t.msec}`;
}
