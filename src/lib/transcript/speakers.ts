import { diffTranscripts } from "./diff";
import type { Word } from "./types";

/**
 * المتحدثون.
 *
 * محرّك التوقيتات (Whisper) لا يميّز المتحدثين، وGemini يميّزهم ولا
 * توقيت دقيقًا عنده. فنأخذ من كلٍّ أقوى ما فيه: نحاذي النصّين، وننقل
 * المتحدث من كلمة Gemini إلى نظيرتها في Whisper. الكلمة التي لا نظير
 * لها تأخذ متحدث جارتها السابقة.
 */
export function transferSpeakers(target: readonly Word[], source: readonly Word[]): Word[] {
  if (!source.some((w) => w.speaker)) return [...target];

  const out = target.map((w) => ({ ...w }));
  const spans = diffTranscripts(target, source);

  const copy = (aFrom: number, aTo: number, bFrom: number) => {
    for (let k = 0; aFrom + k < aTo; k++) {
      const s = source[bFrom + k]?.speaker;
      if (s) out[aFrom + k]!.speaker = s;
    }
  };

  let a = 0;
  let b = 0;
  for (const span of spans) {
    copy(a, span.aStart, b);
    // موضع الاختلاف: أول كلمة مقابلة تعطي متحدثها لكل كلماته
    const s = source[span.bStart]?.speaker;
    if (s) for (let k = span.aStart; k < span.aEnd; k++) out[k]!.speaker = s;
    a = span.aEnd;
    b = span.bEnd;
  }
  copy(a, target.length, b);

  let last: string | undefined;
  for (const w of out) {
    if (w.speaker) last = w.speaker;
    else if (last) w.speaker = last;
  }
  return out;
}

/**
 * أسماء المتحدثين المعروضة: أسماء المجلد بترتيب ظهور المتحدثين،
 * وما زاد عليها «المتحدث ٣»…
 */
export function speakerNames(
  labels: readonly (string | null)[],
  names: readonly string[] = [],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const label of labels) {
    if (!label || map.has(label)) continue;
    const i = map.size;
    map.set(label, names[i]?.trim() || `المتحدث ${i + 1}`);
  }
  return map;
}

/** «الاسم: » في أول الفقرة. الاسم قصير بلا ترقيم جملة، وإلا فليس اسمًا. */
const LABEL = /^([^\s:،.؟!]{1,24}(?: [^\s:،.؟!]{1,24}){0,2}): +/;

export function splitSpeaker(
  paragraph: string,
  known?: ReadonlySet<string>,
): { speaker: string | null; body: string } {
  const m = paragraph.match(LABEL);
  if (!m || (known && !known.has(m[1]!))) return { speaker: null, body: paragraph };
  return { speaker: m[1]!, body: paragraph.slice(m[0].length) };
}

/**
 * أسماء المتحدثين الواردة في نصّ معتمد.
 *
 * فقرة واحدة تبدأ بـ«قال: …» ليست اسم متحدث؛ الاسم ما افتُتحت به
 * فقرتان فأكثر. هذا يحمي نصًّا بلا متحدثين من أن يُقتطع أوله.
 */
export function speakersIn(text: string): Set<string> {
  const counts = new Map<string, number>();
  for (const p of splitParagraphs(text)) {
    const { speaker } = splitSpeaker(p);
    if (speaker) counts.set(speaker, (counts.get(speaker) ?? 0) + 1);
  }
  // نصّ بأسماء متحدثين (اسمٌ تكرّر) تُقبل فيه كل الأسماء، ولو ظهر
  // أحدها مرة واحدة — ضيفٌ عابر له مداخلة واحدة.
  const repeated = [...counts].some(([, n]) => n >= 2);
  return repeated ? new Set(counts.keys()) : new Set();
}

export function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

export function withSpeaker(body: string, speaker: string | null | undefined): string {
  return speaker ? `${speaker}: ${body}` : body;
}

/** النصّ بلا أسماء المتحدثين — للمحاذاة مع الكلمات الموقّتة. */
export function stripSpeakers(text: string): string {
  const known = speakersIn(text);
  return splitParagraphs(text)
    .map((p) => splitSpeaker(p, known).body)
    .join("\n\n");
}
