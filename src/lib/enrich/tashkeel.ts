import { z } from "zod";
import { demoDiacritize } from "@/lib/demo/enrich";
import { env } from "@/lib/env";
import { callReview } from "@/lib/review/provider";
import type { TashkeelMode } from "./types";

/**
 * التشكيل بالنموذج، دفعةً من الفقرات في كل نداء.
 *
 * الدفعة صغيرة عمدًا: النصّ المشكول قرابة ضعف طوله، ونصّ ساعتين لا
 * يخرج في مخرَج واحد. وكل دفعة تُحفظ عند تمامها، فنفاد الحصة في
 * منتصف المقطع يؤجّل الباقي ولا يضيّع ما أُنجز.
 */

/** أقصى طول دفعة بالحروف قبل التشكيل */
export const BATCH_CHARS = 2_500;

const MODE_RULES: Record<TashkeelMode, string> = {
  full: "شكّل كل كلمة تشكيلًا تامًّا: حركات البنية وأواخر الكلمات.",
  light:
    "شكّل ما يلتبس وحده: الكلمة التي تُقرأ بأكثر من وجه، وأواخر الكلمات حيث يتغيّر المعنى بالإعراب. واترك الواضح بلا تشكيل.",
};

const SYSTEM = (mode: TashkeelMode) => `أنت مشكّل نصوص عربية. تُعطى فقرات مرقّمة من تفريغ كلام منطوق، وعملك إضافة الحركات إليها.

${MODE_RULES[mode]}

قيود لا تُخالف:
- أضف الحركات وحدها. لا تغيّر حرفًا ولا تحذف كلمة ولا تضف كلمة ولا تغيّر ترقيمًا.
- الكلام العامي يُشكَّل كما يُنطق بلهجته، ولا يُحوَّل إلى الفصحى. «وش» تبقى «وش».
- إن لم تعرف ضبط كلمة فاتركها بلا تشكيل.
- أعد الفقرات كلها بترتيبها وعددها.`;

const responseSchema = {
  type: "object",
  properties: { paragraphs: { type: "array", items: { type: "string" } } },
  required: ["paragraphs"],
} as const;

export async function diacritizeBatch(
  paragraphs: readonly string[],
  mode: TashkeelMode,
  local?: boolean,
): Promise<string[]> {
  if (env().DEMO_MODE) return demoDiacritize(paragraphs, mode);

  return callReview({
    tier: "review",
    local,
    system: SYSTEM(mode),
    user: paragraphs.map((p, i) => `[${i + 1}] ${p}`).join("\n\n"),
    schema: responseSchema,
    parse: (value) =>
      z
        .object({ paragraphs: z.array(z.string()) })
        .parse(value)
        .paragraphs.map((p) => p.replace(/^\[\d+\]\s*/, "")),
  });
}

/** تقسيم الفقرات دفعاتٍ لا تتجاوز كلٌّ منها الحدّ (إلا فقرة أطول منه وحدها). */
export function batches(paragraphs: readonly string[], limit = BATCH_CHARS): number[][] {
  const out: number[][] = [];
  let current: number[] = [];
  let size = 0;
  paragraphs.forEach((p, i) => {
    if (current.length > 0 && size + p.length > limit) {
      out.push(current);
      current = [];
      size = 0;
    }
    current.push(i);
    size += p.length;
  });
  if (current.length > 0) out.push(current);
  return out;
}
