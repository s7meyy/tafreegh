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

const CLAUSE_END = /[،؛.؟!,;?]$/;
/** بطاقة أقصر من هذا تُضمّ إلى جارتها — لا تُقرأ في لمحتها */
const MIN_CUE_MS = 1_200;

export function buildCues(words: readonly Word[], options: CueOptions = {}): Cue[] {
  const o = { ...DEFAULTS, ...options };
  const groups: Word[][] = [];

  let current: Word[] = [];

  for (const word of words) {
    if (!word.text.trim()) continue;

    if (current.length > 0) {
      const first = current[0]!;
      const previous = current[current.length - 1]!;
      const tooLong = word.endMs - first.startMs > o.maxMs;
      const tooMany = current.length >= o.maxWords;
      // الوقفة الطويلة وتبدّل المتكلم حدّان طبيعيان للبطاقة.
      const afterPause = word.startMs - previous.endMs >= o.gapMs;
      const turn = word.speaker !== previous.speaker;

      if (afterPause || turn) {
        groups.push(current);
        current = [];
      } else if (tooLong || tooMany) {
        // يُقطع عند آخر فاصلة أو نقطة إن وُجدت قريبًا، لا في وسط العبارة.
        let cut = current.length;
        for (let j = current.length - 1; j >= 1; j--) {
          if (CLAUSE_END.test(current[j]!.text.trim())) {
            cut = j + 1;
            break;
          }
        }
        groups.push(current.slice(0, cut));
        current = current.slice(cut);
      }
    }
    current.push(word);
  }
  if (current.length > 0) groups.push(current);

  // بطاقة من كلمة يتيمة أو لمحة قصيرة تُضمّ إلى سابقتها إن اتصلتا.
  const merged: Word[][] = [];
  for (const group of groups) {
    const prev = merged[merged.length - 1];
    const duration = group[group.length - 1]!.endMs - group[0]!.startMs;
    const short = group.length === 1 || duration < MIN_CUE_MS;
    if (
      prev &&
      short &&
      prev.length + group.length <= o.maxWords + 1 &&
      prev[0]!.speaker === group[0]!.speaker &&
      group[0]!.startMs - prev[prev.length - 1]!.endMs < o.gapMs &&
      group[group.length - 1]!.endMs - prev[0]!.startMs <= o.maxMs + 2_000
    ) {
      prev.push(...group);
    } else {
      merged.push([...group]);
    }
  }

  return merged.map((group, i) => ({
    index: i + 1,
    startMs: group[0]!.startMs,
    endMs: group[group.length - 1]!.endMs,
    text: group.map((w) => w.text.trim()).filter(Boolean).join(" "),
  }));
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
