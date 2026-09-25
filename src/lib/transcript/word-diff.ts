import { diffTranscripts } from "./diff";
import type { Word } from "./types";

/**
 * فروق الكلمات بين نسختين من النصّ — لتلوين «مقارنة المراحل».
 *
 * عرض ثلاث نسخ كاملة متشابهة يترك المستخدم يبحث بعينه عمّا تغيّر.
 * هنا يُعلَّم المحذوف والمضاف، فيرى أثر كل مرحلة من نظرة.
 *
 * يُعاد استعمال محاذاة `diffTranscripts` نفسها، فالفرق الذي يُعرض هو
 * الفرق الذي تحسبه المراجعة: اختلاف الرسم وحده (همزة، تاء مربوطة)
 * لا يُعدّ تغييرًا هناك، لكنه تغيير يريد المستخدم أن يراه هنا — لذلك
 * تُقارن الكلمات حرفيًا بعد المحاذاة، ويُعلَّم ما تغيّر رسمه.
 */

export type SegmentKind = "same" | "added" | "removed" | "break";

export interface DiffSegment {
  kind: SegmentKind;
  text: string;
}

/** فاصل الفقرة رمزٌ مستقل، فلا تلتحم فقرتان عند المقارنة. */
const BREAK = " ";

function tokenize(text: string): string[] {
  return text
    .trim()
    .split(/\n\s*\n/)
    .map((p) => p.trim().split(/\s+/).filter(Boolean))
    .filter((p) => p.length > 0)
    .flatMap((p, i) => (i === 0 ? p : [BREAK, ...p]));
}

function asWords(tokens: readonly string[]): Word[] {
  return tokens.map((text) => ({ text, startMs: 0, endMs: 0 }));
}

export function wordDiff(before: string, after: string): DiffSegment[] {
  const a = tokenize(before);
  const b = tokenize(after);
  const spans = diffTranscripts(asWords(a), asWords(b));

  const out: DiffSegment[] = [];
  const push = (kind: SegmentKind, text: string) => {
    if (text === BREAK) {
      out.push({ kind: "break", text: "" });
      return;
    }
    const last = out[out.length - 1];
    // الكلمات المتجاورة من النوع نفسه تُضمّ في مقطع واحد.
    if (last && last.kind === kind) last.text += ` ${text}`;
    else out.push({ kind, text });
  };

  let i = 0;
  let j = 0;

  const equalRun = (aUntil: number, bUntil: number) => {
    while (i < aUntil && j < bUntil) {
      // المحاذاة تتجاهل فروق الرسم؛ نُظهرها هنا.
      if (a[i] === b[j]) push("same", b[j]!);
      else {
        push("removed", a[i]!);
        push("added", b[j]!);
      }
      i++;
      j++;
    }
  };

  for (const span of spans) {
    equalRun(span.aStart, span.bStart);
    for (; i < span.aEnd; i++) push("removed", a[i]!);
    for (; j < span.bEnd; j++) push("added", b[j]!);
  }
  equalRun(a.length, b.length);
  for (; i < a.length; i++) push("removed", a[i]!);
  for (; j < b.length; j++) push("added", b[j]!);

  return out;
}

/** هل بين النسختين فرق يستحق العرض؟ */
export function hasChanges(segments: readonly DiffSegment[]): boolean {
  return segments.some((s) => s.kind === "added" || s.kind === "removed");
}
