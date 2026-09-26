import { retime } from "./retime";
import { speakersIn, splitSpeaker } from "./speakers";
import type { Word } from "./types";

/**
 * النصّ للاستماع: كل كلمة بموضعها في النصّ وتوقيتها في الصوت.
 *
 * النصّ هنا ما في المحرّر الآن — بعد المراجعتين وتحرير المستخدم — لا
 * كلمات المحرّك الخام. فتُنقل التوقيتات إليه بالمحاذاة (`retime`)،
 * فتتبع الإضاءةُ النصَّ الذي يقرؤه المستخدم لا نصًّا غيره.
 */

export interface ListenWord {
  text: string;
  /** موضعها في نصّ المحرّر — للانتقال إليها عند التحرير */
  start: number;
  end: number;
  startMs: number;
  endMs: number;
}

export interface ListenParagraph {
  speaker: string | null;
  /** فهرس أول كلماتها وآخرها (غير شامل) في `words` */
  from: number;
  to: number;
}

export interface ListenLayout {
  paragraphs: ListenParagraph[];
  words: ListenWord[];
}

export function listenLayout(text: string, timed: readonly Word[]): ListenLayout {
  const known = speakersIn(text);
  const paragraphs: ListenParagraph[] = [];
  const tokens: { text: string; start: number; end: number }[] = [];
  const bodies: string[] = [];

  const breaks = /\n\s*\n/g;
  let from = 0;
  const ranges: [number, number][] = [];
  for (let m = breaks.exec(text); m; m = breaks.exec(text)) {
    ranges.push([from, m.index]);
    from = m.index + m[0].length;
  }
  ranges.push([from, text.length]);

  for (const [lo, hi] of ranges) {
    const raw = text.slice(lo, hi);
    const lead = raw.length - raw.trimStart().length;
    const paragraph = raw.trim();
    if (!paragraph) continue;

    const { speaker, body } = splitSpeaker(paragraph, known);
    const bodyStart = lo + lead + (paragraph.length - body.length);
    const first = tokens.length;
    for (const m of body.matchAll(/\S+/g)) {
      tokens.push({ text: m[0], start: bodyStart + m.index!, end: bodyStart + m.index! + m[0].length });
    }
    if (tokens.length > first) {
      paragraphs.push({ speaker, from: first, to: tokens.length });
      bodies.push(body);
    }
  }

  // `retime` يعيد كلمة لكل كلمة من النصّ بالترتيب نفسه
  const times = retime(bodies.join("\n\n"), timed);
  const words = tokens.map((t, i) => ({
    ...t,
    startMs: times[i]?.startMs ?? 0,
    endMs: times[i]?.endMs ?? 0,
  }));

  return { paragraphs, words };
}

/** الكلمة الجارية عند لحظة ما: آخر كلمة بدأت قبلها. */
export function wordAt(words: readonly ListenWord[], ms: number): number {
  let lo = 0;
  let hi = words.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (words[mid]!.startMs <= ms) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}
