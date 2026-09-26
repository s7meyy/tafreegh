import { z } from "zod";
import { demoAuditEdits } from "@/lib/demo/reviewer";
import { env } from "@/lib/env";
import { callReview } from "./provider";
import type { ProposedEdit } from "./types";

/**
 * المرحلة الثالثة — التدقيق.
 *
 * ليست قراءة ثانية للنصّ كله. هي **حكم على عمل المرحلة الثانية**:
 * تستقبل التعديلات بأسبابها وتقرّر قبول كل واحد أو رفضه أو استبداله.
 *
 * هذا ليس تحسينًا للتكلفة فحسب (§3.2) — هو أدقّ أيضًا: إعادة القراءة
 * من الصفر تدفع النموذج إلى «تحسين» ما لا دليل عليه، وهو الخطر نفسه
 * الذي بُني كل هذا لتفاديه.
 */

export type Verdict = "accept" | "reject" | "replace";

export interface EditVerdict {
  index: number;
  verdict: Verdict;
  /** بديل، حين يكون الحكم `replace` */
  to?: string;
  note?: string;
}

const SYSTEM = `أنت مدقّق أعلى. مدقّق قبلك اقترح تعديلات على تفريغ آلي، وعملك الحكم عليها.

**لم تسمع المقطع الصوتي، ولا هو سمعه.** كلاكما يعمل على النصّ والأدلة. فكن أميل إلى الرفض عند الشك: النصّ الأصلي جاء من محرّك سمع الصوت، والتعديل جاء من نموذج لم يسمعه.

لكل تعديل احكم بواحد:
- accept — التعديل صحيح وسببه قائم.
- reject — التعديل لا يقوم عليه دليل كافٍ، أو يغيّر المعنى، أو يُفصح عامية في نمط لا يطلب ذلك.
- replace — الموضع يحتاج تصحيحًا لكن البديل المقترح خطأ؛ اذكر البديل الصحيح في to.

اردد كل تعديل برقمه (index) كما ورد. لا تضف تعديلات جديدة.`;

const responseSchema = {
  type: "object",
  properties: {
    verdicts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "integer" },
          verdict: { type: "string", enum: ["accept", "reject", "replace"] },
          to: { type: "string" },
          note: { type: "string" },
        },
        required: ["index", "verdict"],
      },
    },
  },
  required: ["verdicts"],
} as const;

const payloadSchema = z.object({
  verdicts: z.array(
    z.object({
      index: z.number().int().nonnegative(),
      verdict: z.enum(["accept", "reject", "replace"]),
      to: z.string().optional(),
      note: z.string().optional(),
    }),
  ),
});

export interface Stage3Input {
  paragraphs: readonly string[];
  edits: readonly ProposedEdit[];
  local?: boolean;
}

export async function auditEdits(input: Stage3Input): Promise<EditVerdict[]> {
  if (input.edits.length === 0) return [];

  // نعرض الفقرات المعنيّة وحدها: عرض النصّ كاملًا يُنفق الحصة بلا فائدة.
  const touched = [...new Set(input.edits.map((e) => e.para))].sort((a, b) => a - b);

  const user = [
    "## الفقرات المعنيّة",
    touched
      .map((n) => `[${n}] ${input.paragraphs[n - 1] ?? "(فقرة غير موجودة)"}`)
      .join("\n\n"),
    "",
    "## التعديلات المقترحة",
    input.edits
      .map(
        (e, i) =>
          `${i}. الفقرة ${e.para} · «${e.from}» ← «${e.to}» · السبب: ${e.reason}`,
      )
      .join("\n"),
  ].join("\n");

  if (env().DEMO_MODE) return reconcile(demoAuditEdits(input.edits), input.edits.length);

  const verdicts = await callReview({
    tier: "audit",
    local: input.local,
    system: SYSTEM,
    user,
    schema: responseSchema,
    parse: (value) => payloadSchema.parse(value).verdicts,
  });

  return reconcile(verdicts, input.edits.length);
}

/**
 * كل تعديل يحتاج حكمًا. النموذج قد يُغفل بعضها أو يكرّر أو يخترع رقمًا،
 * فما أُغفل يُرفض احتياطًا — الافتراض هو النصّ الأصلي لا التعديل.
 */
export function reconcile(
  verdicts: readonly EditVerdict[],
  editCount: number,
): EditVerdict[] {
  const byIndex = new Map<number, EditVerdict>();
  for (const v of verdicts) {
    if (v.index < 0 || v.index >= editCount) continue;
    // الحكم الأول يفوز؛ التكرار من النموذج لا من المدخلات.
    if (!byIndex.has(v.index)) byIndex.set(v.index, v);
  }

  return Array.from({ length: editCount }, (_, i) => {
    const found = byIndex.get(i);
    if (found) {
      // replace بلا بديل حكمٌ ناقص — يُعامل رفضًا.
      if (found.verdict === "replace" && !found.to?.trim()) {
        return { index: i, verdict: "reject" as const, note: "بديل مفقود" };
      }
      return found;
    }
    return { index: i, verdict: "reject" as const, note: "لم يُحكم عليه" };
  });
}

/** تحويل الأحكام إلى التعديلات المعتمدة نهائيًا. */
export function applyVerdicts(
  edits: readonly ProposedEdit[],
  verdicts: readonly EditVerdict[],
): ProposedEdit[] {
  const out: ProposedEdit[] = [];

  for (const verdict of verdicts) {
    const edit = edits[verdict.index];
    if (!edit) continue;

    if (verdict.verdict === "accept") out.push(edit);
    else if (verdict.verdict === "replace" && verdict.to) {
      out.push({ ...edit, to: verdict.to });
    }
  }

  return out;
}
