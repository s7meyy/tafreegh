import { z } from "zod";
import { demoSuggestTitle } from "@/lib/demo/reviewer";
import { env } from "@/lib/env";
import { callReview } from "./provider";

/**
 * عنوان مقترح من محتوى المقطع.
 *
 * اسم الملف كثيرًا ما يكون «interview» أو «REC_0012» أو «تسجيل جديد».
 * فنقترح عنوانًا من الكلام نفسه. لا يُفرض: يُستبدل آليًا بالاسم العام
 * وحده، ويُعرض اقتراحًا على غيره.
 */

const SYSTEM = `اقترح عنوانًا عربيًا قصيرًا (من ثلاث كلمات إلى ثماني) لتفريغ هذا المقطع، يصف موضوعه كما يُسمّى ملف أو حلقة.
- بلا علامات تنصيص ولا نقطة في آخره.
- من المضمون وحده؛ لا تخترع اسمًا أو تاريخًا لم يرد.`;

const responseSchema = {
  type: "object",
  properties: { title: { type: "string" } },
  required: ["title"],
} as const;

/** أول الكلام وأوسطه وآخره يكفي لعنوان — لا حاجة لإنفاق رموز النصّ كله. */
function excerpt(paragraphs: readonly string[], budget = 2_500): string {
  const all = paragraphs.join("\n\n");
  if (all.length <= budget) return all;
  const third = Math.floor(budget / 3);
  const mid = Math.floor(all.length / 2);
  return [all.slice(0, third), all.slice(mid - third / 2, mid + third / 2), all.slice(-third)].join("\n…\n");
}

export async function suggestTitle(
  paragraphs: readonly string[],
  local?: boolean,
): Promise<string | null> {
  if (paragraphs.length === 0) return null;
  const raw = env().DEMO_MODE
    ? demoSuggestTitle(paragraphs)
    : await callReview({
        tier: "review",
        local,
        system: SYSTEM,
        user: excerpt(paragraphs),
        schema: responseSchema,
        parse: (value) => z.object({ title: z.string() }).parse(value).title,
      });
  return cleanTitle(raw);
}

export function cleanTitle(raw: string): string | null {
  const title = raw
    .replace(/["«»“”'.]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return title.split(" ").length >= 2 ? title : null;
}

/**
 * اسم عام لا يصف المحتوى: اسم ملف من مسجّل أو هاتف أو تطبيق محادثة،
 * أو كلمة إنجليزية عامة، أو أرقام وتاريخ.
 */
const GENERIC = [
  /^(rec(ording)?|audio|voice|sound|record|interview|untitled|new recording|track|file|clip|video|vid|mov|img|dsc|ptt|aud)[\s_\-.\d()]*$/i,
  /^(whatsapp|telegram|zoom|teams|meet|screen ?recording)\b/i,
  /^(تسجيل|تسجيل جديد|مقطع|صوت|ملف|مقابلة|فيديو|بلا عنوان)[\s_\-\d()]*$/,
  /^[\d\s_\-.:()]+$/,
];

export function isGenericTitle(title: string): boolean {
  const t = title.trim();
  return t.length === 0 || GENERIC.some((re) => re.test(t));
}
