import { z } from "zod";
import { demoInferTurns } from "@/lib/demo/reviewer";
import { env } from "@/lib/env";
import { callReview } from "./provider";

/**
 * استنتاج المتحدثين من النصّ.
 *
 * حين لا يميّز محرّك التفريغ المتحدثين (Groq وحده، أو المحلي) يبقى
 * النصّ بلا أسماء. لكن المقابلة تُعرف أدوارها من كلامها: السؤال
 * والجواب، والترحيب والشكر. فنسأل نموذج المراجعة: أين تبدأ كل مداخلة،
 * ومن صاحبها؟
 *
 * والجواب لا يمسّ كلمة: كل مداخلة تُحدَّد باقتباس من أولها، فإن لم
 * يُوجد الاقتباس حرفيًا في فقرته أُسقطت. فأسوأ ما يقع خطأ في اسم
 * أو في موضع فاصل — لا في الكلام نفسه.
 */

export interface Turn {
  para: number;
  /** أول كلمات المداخلة كما في الفقرة؛ فارغ = أول الفقرة */
  quote: string;
  speaker: number;
}

export interface Segment {
  text: string;
  speaker: string | null;
  /** من أين جاءت: الفقرة الأصلية وموضع أولها فيها */
  origin: { para: number; start: number };
}

const SYSTEM = `أمامك تفريغ حوار عربي مقسّم فقرات مرقّمة، بلا أسماء المتحدثين. عملك تعيين المداخلات: أين يبدأ كلام كل متحدث، ومن هو.

- رقّم المتحدثين بترتيب ظهورهم: 1 لأول من يتكلم، ثم 2…
- لكل مداخلة: رقم الفقرة التي تبدأ فيها (para)، وأول ثلاث كلمات منها منقولة **حرفيًا** من الفقرة (quote) — أو quote فارغ إن بدأت المداخلة من أول الفقرة، ورقم المتحدث (speaker).
- قد تبدأ مداخلة في وسط فقرة؛ اقتبس أولها كما هو.
- لا تعدّل النصّ ولا تلخّصه. أخرج المداخلات وحدها.
- إن كان المتكلم واحدًا في المقطع كله، أو لم تستطع التمييز، فأعد قائمة فارغة.`;

const responseSchema = {
  type: "object",
  properties: {
    turns: {
      type: "array",
      items: {
        type: "object",
        properties: {
          para: { type: "integer" },
          quote: { type: "string" },
          speaker: { type: "integer" },
        },
        required: ["para", "quote", "speaker"],
      },
    },
  },
  required: ["turns"],
} as const;

const payloadSchema = z.object({
  turns: z.array(
    z.object({
      para: z.number().int().positive(),
      quote: z.string(),
      speaker: z.number().int().positive().max(12),
    }),
  ),
});

export async function inferTurns(input: {
  paragraphs: readonly string[];
  /** أسماء المتحدثين المعروفة من إعدادات المجلد، بترتيب ظهورهم */
  names: readonly string[];
  local?: boolean;
}): Promise<Turn[]> {
  if (env().DEMO_MODE) return demoInferTurns(input.paragraphs);

  const hint = input.names.length
    ? `المتحدثون في هذا المجلد بترتيب ظهورهم عادةً: ${input.names.map((n, i) => `${i + 1}. ${n}`).join("، ")}.`
    : "عدد المتحدثين غير معروف.";

  return callReview({
    tier: "review",
    local: input.local,
    system: SYSTEM,
    user: [hint, "", input.paragraphs.map((p, i) => `[${i + 1}] ${p}`).join("\n\n")].join("\n"),
    schema: responseSchema,
    parse: (value) => payloadSchema.parse(value).turns,
  });
}

const LETTER = /[\p{L}\p{N}\p{M}]/u;

/**
 * تطبيق المداخلات: فقرات جديدة تبدأ حيث تبدأ المداخلات، بأسمائها.
 *
 * يتحقّق من كل مداخلة (فقرتها موجودة، واقتباسها في الفقرة على حدّ
 * كلمة) ويُسقط ما لا يصحّ. والنصّ الناتج هو النصّ نفسه كلمةً بكلمة،
 * بفواصل فقرات زائدة لا غير.
 */
export function applyTurns(
  paragraphs: readonly string[],
  turns: readonly Turn[],
): { segments: Segment[]; applied: number } {
  const cuts = new Map<number, Map<number, number>>();
  let applied = 0;

  for (const turn of turns) {
    const paragraph = paragraphs[turn.para - 1];
    if (paragraph === undefined) continue;
    const at = locateQuote(paragraph, turn.quote.trim());
    if (at === null) continue;
    const list = cuts.get(turn.para) ?? new Map<number, number>();
    list.set(at, turn.speaker);
    cuts.set(turn.para, list);
    applied++;
  }

  const segments: Segment[] = [];
  let current: string | null = null;

  paragraphs.forEach((paragraph, i) => {
    const points = [...(cuts.get(i + 1) ?? new Map<number, number>())].sort((a, b) => a[0] - b[0]);
    let from = 0;
    const push = (start: number, end: number) => {
      const raw = paragraph.slice(start, end);
      const piece = raw.trim();
      if (!piece) return;
      const lead = raw.length - raw.trimStart().length;
      segments.push({ text: piece, speaker: current, origin: { para: i + 1, start: start + lead } });
    };
    for (const [at, speaker] of points) {
      if (at > from) push(from, at);
      current = String(speaker);
      from = at;
    }
    push(from, paragraph.length);
  });

  return { segments: mergeSameSpeaker(segments), applied };
}

/** موضع الاقتباس في الفقرة على حدّ كلمة؛ الاقتباس الفارغ أول الفقرة. */
function locateQuote(paragraph: string, quote: string): number | null {
  if (!quote) return 0;
  for (let i = paragraph.indexOf(quote); i !== -1; i = paragraph.indexOf(quote, i + 1)) {
    const before = paragraph[i - 1];
    if (!before || !LETTER.test(before)) return i;
  }
  return null;
}

/**
 * فقرتان متتاليتان لمتحدث واحد تبقيان فقرتين — الفقرة وقفة في الكلام
 * لا تبدّل متكلم. لكن قطعة قصيرة جدًا انفصلت عن فقرتها لخطأ في الاقتباس
 * تُردّ إلى ما قبلها.
 */
function mergeSameSpeaker(segments: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const seg of segments) {
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.speaker === seg.speaker &&
      prev.origin.para === seg.origin.para &&
      seg.text.split(/\s+/).length < 3
    ) {
      prev.text = `${prev.text} ${seg.text}`;
    } else {
      out.push({ ...seg });
    }
  }
  return out;
}

/**
 * نقل موضع من الفقرات الأصلية إلى الفقرات بعد تقسيم المداخلات — لتبقى
 * مواضع الشك والتعديلات دالّةً على مكانها في النصّ المعروض.
 */
export function remapPosition(
  segments: readonly Segment[],
  para: number,
  offset: number,
): { para: number; offset: number } {
  let best: { para: number; offset: number } | null = null;
  segments.forEach((seg, i) => {
    if (seg.origin.para !== para || seg.origin.start > offset) return;
    best = { para: i + 1, offset: offset - seg.origin.start };
  });
  return best ?? { para, offset };
}
