import { z } from "zod";
import { demoSummarize } from "@/lib/demo/enrich";
import { env } from "@/lib/env";
import { callReview } from "@/lib/review/provider";
import type { SummaryData, SummaryPoint } from "./types";

/**
 * الملخص.
 *
 * ملخص لا يُعرف مصدره لا يُوثق به. فكل نقطة تُسند إلى فقراتها بأرقامها،
 * والواجهة تحوّل الرقم إلى توقيت يُسمع منه — فيتحقّق المستخدم من أي
 * نقطة بنقرة. والإسناد إلى فقرة غير موجودة يُسقط.
 *
 * النصّ الطويل يُلخَّص أجزاءً، ثم تُجمع نقاط الأجزاء في ملخص واحد —
 * النموذج المحلي لا يتّسع سياقه لساعتين من الكلام.
 */

/** فوق هذا الطول يُلخَّص النصّ أجزاءً */
export const CHUNK_CHARS = 40_000;

const RULES = `- من النصّ وحده: لا تضف معلومة أو رأيًا أو استنتاجًا لم يرد فيه.
- انسب الأقوال إلى أصحابها إن كان في النصّ متحدثون بأسمائهم.
- اكتب بعربية فصيحة واضحة، ولو كان الكلام عاميًا.
- كل نقطة تذكر أرقام الفقرات التي تستند إليها في paras.`;

const SYSTEM_FULL = `لخّص تفريغ هذا المقطع المنطوق. الفقرات مرقّمة.

أخرج:
- brief: خلاصة من جملتين إلى أربع جمل.
- points: أهم النقاط، من ثلاث إلى عشر، كل نقطة جملة أو جملتان.
- topics: الموضوعات الرئيسة، كلمة أو كلمتان لكلٍّ، إلى ست.

${RULES}`;

const SYSTEM_CHUNK = `هذا جزء من تفريغ مقطع منطوق طويل، فقراته مرقّمة بأرقامها في المقطع كله. استخرج أهم نقاطه (إلى ثمانٍ).

${RULES}`;

const SYSTEM_REDUCE = `هذه نقاط استُخرجت من أجزاء مقطع منطوق طويل، كلٌّ بأرقام فقراتها. اجمعها في ملخص واحد للمقطع كله.

أخرج:
- brief: خلاصة من جملتين إلى أربع جمل.
- points: أهم النقاط للمقطع كله، إلى عشر؛ ادمج المكرر، وأبقِ أرقام الفقرات من النقاط التي دمجتها.
- topics: الموضوعات الرئيسة، إلى ست.

لا تضف ما ليس في النقاط.`;

const pointSchema = { type: "object", properties: { text: { type: "string" }, paras: { type: "array", items: { type: "integer" } } }, required: ["text", "paras"] };

const fullSchema = {
  type: "object",
  properties: {
    brief: { type: "string" },
    points: { type: "array", items: pointSchema },
    topics: { type: "array", items: { type: "string" } },
  },
  required: ["brief", "points", "topics"],
} as const;

const chunkSchema = {
  type: "object",
  properties: { points: { type: "array", items: pointSchema } },
  required: ["points"],
} as const;

const point = z.object({ text: z.string(), paras: z.array(z.number().int()) });
const full = z.object({ brief: z.string(), points: z.array(point), topics: z.array(z.string()) });

function numbered(paragraphs: readonly string[], from: number, to: number): string {
  return paragraphs
    .slice(from, to)
    .map((p, i) => `[${from + i + 1}] ${p}`)
    .join("\n\n");
}

export async function summarize(
  paragraphs: readonly string[],
  local?: boolean,
): Promise<SummaryData> {
  if (env().DEMO_MODE) return clean(demoSummarize(paragraphs), paragraphs.length);

  const total = paragraphs.reduce((s, p) => s + p.length, 0);
  if (total <= CHUNK_CHARS) {
    const out = await callReview({
      tier: "review",
      local,
      system: SYSTEM_FULL,
      user: numbered(paragraphs, 0, paragraphs.length),
      schema: fullSchema,
      parse: (v) => full.parse(v),
    });
    return clean(out, paragraphs.length);
  }

  const collected: SummaryPoint[] = [];
  for (const [from, to] of chunks(paragraphs)) {
    const part = await callReview({
      tier: "review",
      local,
      system: SYSTEM_CHUNK,
      user: numbered(paragraphs, from, to),
      schema: chunkSchema,
      parse: (v) => z.object({ points: z.array(point) }).parse(v).points,
    });
    collected.push(...part);
  }

  const out = await callReview({
    tier: "review",
    local,
    system: SYSTEM_REDUCE,
    user: collected.map((p) => `- ${p.text} (الفقرات: ${p.paras.join("، ")})`).join("\n"),
    schema: fullSchema,
    parse: (v) => full.parse(v),
  });
  return clean(out, paragraphs.length);
}

/** نطاقات فقرات لا يتجاوز كلٌّ منها حدّ الجزء. */
export function chunks(paragraphs: readonly string[], limit = CHUNK_CHARS): [number, number][] {
  const out: [number, number][] = [];
  let from = 0;
  let size = 0;
  paragraphs.forEach((p, i) => {
    if (i > from && size + p.length > limit) {
      out.push([from, i]);
      from = i;
      size = 0;
    }
    size += p.length;
  });
  out.push([from, paragraphs.length]);
  return out;
}

/** الإسناد إلى فقرة غير موجودة يُسقط، والفارغ يُحذف، والمكرر يُوحَّد. */
export function clean(data: { brief: string; points: SummaryPoint[]; topics: string[] }, count: number): SummaryData {
  return {
    brief: data.brief.trim(),
    points: data.points
      .map((p) => ({
        text: p.text.trim(),
        paras: [...new Set(p.paras.filter((n) => Number.isInteger(n) && n >= 1 && n <= count))].sort((a, b) => a - b),
      }))
      .filter((p) => p.text),
    topics: [...new Set(data.topics.map((t) => t.trim()).filter(Boolean))].slice(0, 6),
  };
}
