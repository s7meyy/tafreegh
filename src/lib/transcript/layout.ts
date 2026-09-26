import type { Word } from "./types";

/**
 * تقسيم التفريغ إلى فقرات.
 *
 * المحرّك يعطي سيلًا من الكلمات بلا فقرات، فيخرج تفريغ ربع ساعة كتلة
 * واحدة: لا يُقرأ، ولا يُقتبس منه، ويجعل «الفقرة» — وهي وحدة المراجعة
 * — بلا معنى. فنقسّم حيث يقسّم الكلام نفسه: عند تبدّل المتكلم أولًا،
 * ثم عند الوقفات الطويلة، ثم عند نهاية جملة إذا طالت الفقرة.
 *
 * ونحفظ موضع كل كلمة في نصّ فقرتها: هو ما يربط الدليل (كلمة بتوقيتها)
 * بموضعه في النصّ، فلا يُبحث عنه بالنصّ فيُصاب أول تكرار له.
 */

export interface LayoutOptions {
  /** وقفة تقطع الفقرة إن بلغت الفقرة `minWords` */
  pauseMs?: number;
  minWords?: number;
  /** بعد هذا الطول تُقطع الفقرة عند أول نهاية جملة أو وقفة قصيرة */
  softMaxWords?: number;
  /** حدّ أقصى لا تتجاوزه فقرة بحال */
  hardMaxWords?: number;
}

const DEFAULTS: Required<LayoutOptions> = {
  pauseMs: 1_500,
  minWords: 20,
  softMaxWords: 90,
  hardMaxWords: 160,
};

export interface LaidParagraph {
  text: string;
  speaker: string | null;
  startMs: number;
  endMs: number;
  /** فهرس أول كلمة وآخرها (غير شامل) في مصفوفة الكلمات */
  firstWord: number;
  endWord: number;
}

export interface WordPosition {
  /** رقم الفقرة ابتداءً من 1 */
  para: number;
  /** موضع الكلمة في نصّ فقرتها */
  start: number;
  end: number;
}

export interface Layout {
  paragraphs: LaidParagraph[];
  /** موضع كل كلمة؛ `null` للكلمة الفارغة */
  positions: (WordPosition | null)[];
}

const SENTENCE_END = /[.؟?!]$/;
const PUNCT_ONLY = /^[،؛؟!.:,;?]+$/;

/** الترقيم اللاتيني داخل نصّ عربي إلى نظيره العربي، بلا تغيير في الطول. */
function tidyToken(text: string): string {
  return text.trim().replace(/,/g, "،").replace(/;/g, "؛").replace(/\?/g, "؟");
}

export function layoutParagraphs(words: readonly Word[], options: LayoutOptions = {}): Layout {
  const o = { ...DEFAULTS, ...options };
  const paragraphs: LaidParagraph[] = [];
  const positions: (WordPosition | null)[] = new Array(words.length).fill(null);

  let text = "";
  let count = 0;
  let first = -1;
  let speaker: string | null = null;

  const close = (endWord: number) => {
    if (first === -1) return;
    paragraphs.push({
      text,
      speaker,
      startMs: words[first]!.startMs,
      endMs: words[endWord - 1]!.endMs,
      firstWord: first,
      endWord,
    });
    text = "";
    count = 0;
    first = -1;
  };

  let previous: Word | null = null;
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    const token = tidyToken(word.text);
    if (!token) continue;

    if (previous && first !== -1) {
      const gap = word.startMs - previous.endMs;
      const turn = Boolean(word.speaker && speaker && word.speaker !== speaker);
      const ended = SENTENCE_END.test(previous.text.trim());
      const cut =
        turn ||
        (gap >= o.pauseMs && count >= o.minWords) ||
        (count >= o.softMaxWords && (ended || gap >= 600)) ||
        count >= o.hardMaxWords;
      if (cut) close(i);
    }

    if (first === -1) {
      first = i;
      speaker = word.speaker ?? null;
    } else if (!speaker && word.speaker) {
      speaker = word.speaker;
    }

    const para = paragraphs.length + 1;
    if (PUNCT_ONLY.test(token) && text) {
      // علامة ترقيم مستقلة تلتصق بما قبلها
      positions[i] = { para, start: text.length, end: text.length + token.length };
      text += token;
    } else {
      if (text) text += " ";
      positions[i] = { para, start: text.length, end: text.length + token.length };
      text += token;
      count++;
    }
    previous = word;
  }
  close(words.length);

  return { paragraphs, positions };
}
