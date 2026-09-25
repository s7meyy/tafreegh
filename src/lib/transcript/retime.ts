import { diffTranscripts } from "./diff";
import type { Word } from "./types";

/**
 * نقل التوقيتات من التفريغ الخام إلى النصّ المعتمد.
 *
 * التوقيتات لا يعرفها إلا محرّك التفريغ، والنصّ المعتمد مرّ بعده
 * بمراجعتين وتحرير يدوي. فلو صُدّرت بطاقات الترجمة من الكلمات الخام
 * لخرجت بأخطاء صُحّحت فعلًا، وبلا تعديلات المستخدم.
 *
 * نحاذي النصّين: الكلمة التي لم تتغيّر تأخذ توقيتها كما هو، والموضع
 * الذي تغيّر يأخذ مدى الكلمات التي حلّ محلها موزَّعًا على كلماته
 * الجديدة. ما أُضيف بلا مقابل يأخذ لحظة جاره.
 */
export function retime(finalText: string, timed: readonly Word[]): Word[] {
  const tokens = finalText.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  if (timed.length === 0) return [];

  // الجانب الثاني بلا توقيت؛ المحاذاة تقارن النصّ وحده.
  const target: Word[] = tokens.map((text) => ({ text, startMs: 0, endMs: 0 }));
  const spans = diffTranscripts(timed, target);

  const out: Word[] = [];
  let a = 0;
  let b = 0;

  const copyEqual = (aUntil: number, bUntil: number) => {
    while (a < aUntil && b < bUntil) {
      const src = timed[a]!;
      out.push({ ...src, text: tokens[b]! });
      a++;
      b++;
    }
  };

  for (const span of spans) {
    copyEqual(span.aStart, span.bStart);

    const replaced = timed.slice(span.aStart, span.aEnd);
    const count = span.bEnd - span.bStart;

    if (count > 0) {
      const prev = out[out.length - 1];
      const startMs = replaced[0]?.startMs ?? prev?.endMs ?? 0;
      const endMs =
        replaced[replaced.length - 1]?.endMs ?? timed[span.aEnd]?.startMs ?? startMs;
      const step = Math.max(0, endMs - startMs) / count;

      for (let k = 0; k < count; k++) {
        out.push({
          text: tokens[span.bStart + k]!,
          startMs: Math.round(startMs + step * k),
          endMs: Math.round(startMs + step * (k + 1)),
        });
      }
    }

    a = span.aEnd;
    b = span.bEnd;
  }

  copyEqual(timed.length, tokens.length);

  // ما تبقّى من النصّ المعتمد بعد نفاد الكلمات الموقّتة (إضافة في الآخر)
  const last = out[out.length - 1]?.endMs ?? 0;
  while (b < tokens.length) {
    out.push({ text: tokens[b]!, startMs: last, endMs: last });
    b++;
  }

  return out;
}
