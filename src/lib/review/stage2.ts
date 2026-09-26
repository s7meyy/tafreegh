import { z } from "zod";
import { formatEvidence } from "./evidence";
import { demoProposeEdits } from "@/lib/demo/reviewer";
import { env } from "@/lib/env";
import { callReview } from "./provider";
import { EDIT_REASONS, type EvidenceSpan, type ProposedEdit } from "./types";

/**
 * المرحلة الثانية — التصحيح.
 *
 * النموذج لا يسمع الصوت، فلا يُطلب منه «تحسين» النصّ. يُطلب منه أمر
 * واحد: انظر في المواضع المعلّمة وحدها، واقترح لها بديلًا إن كان
 * السياق يرجّحه. وما اقترحه يمرّ بعد ذلك على حارس `applyEdits`.
 */

export type TranscriptionMode = "verbatim" | "clean" | "formal";

const MODE_RULES: Record<TranscriptionMode, string> = {
  verbatim: [
    "نمط التفريغ: **حرفي**.",
    "- لا تحذف تلعثمًا ولا تكرارًا ولا كلمات حشو. كلها جزء من التفريغ.",
    "- لا تغيّر لفظًا عاميًا إلى فصيح بحال.",
  ].join("\n"),
  clean: [
    "نمط التفريغ: **منقّح**.",
    "- احذف التلعثم والتكرار غير المقصود وكلمات الحشو (أه، يعني المكررة).",
    "- أبقِ كل لفظ عامي كما نُطق. «وش» تبقى «وش» ولا تصير «ماذا».",
  ].join("\n"),
  formal: [
    "نمط التفريغ: **مُفصَّح**.",
    "- حوّل العبارة العامية إلى فصحى سليمة مع حفظ المعنى كاملًا.",
    "- لا تضف معنى ولا تحذف معنى. التحويل في اللفظ لا في المضمون.",
  ].join("\n"),
};

const SYSTEM = `أنت مدقّق تفريغ عربي. عملك تصحيح أخطاء محرّك التفريغ الآلي، لا تحسين الأسلوب.

**أنت لم تسمع المقطع الصوتي.** فلا تعتمد على حدسك فيما «يُفترض» أن يكون قد قيل. اعتمد على ما يُعرض عليك من أدلة فقط.

القاعدة الملزمة: لا تقترح تعديلًا إلا ولك عليه سبب من هذه القائمة:
- glossary — النصّ يخالف رسم مصطلح في مسرد المشروع.
- low_confidence — المحرّك نفسه قال إنه غير واثق من الكلمة، والسياق يرجّح غيرها.
- engine_disagreement — اختلف محرّكان، والسياق يرجّح أحد الاحتمالين.
- orthography — خطأ رسم لا يغيّر الكلمة (همزة، تاء مربوطة، ألف مقصورة).
- punctuation — علامة ترقيم ناقصة أو زائدة.
- disfluency — تلعثم أو حشو يُحذف (في النمط المنقّح وحده).

قيود لا تُخالف:
1. لا تعدّل كلمة إلا إن كانت في قائمة «المواضع المشكوك فيها»، إلا لتصحيح رسم أو ترقيم أو حذف حشو.
2. حقل from يجب أن يطابق نصّ الفقرة **حرفًا بحرف**. لا تقتبس بتصرّف. الموضع المشكوك فيه معروض بين ⟦ ⟧ مع ما حوله؛ لا تنقل القوسين إلى from.
3. إن تكرّر الخطأ نفسه في مواضع مشكوك فيها عدة، فاقترح تعديلًا لكل موضع.
4. إن لم ترجّح بديلًا، لا تقترح شيئًا. ترك الخطأ أهون من اختراع كلام لم يُقَل.
5. لا تعِد كتابة النصّ. أخرج التعديلات وحدها.`;

const responseSchema = {
  type: "object",
  properties: {
    edits: {
      type: "array",
      items: {
        type: "object",
        properties: {
          para: { type: "integer" },
          from: { type: "string" },
          to: { type: "string" },
          reason: { type: "string", enum: [...EDIT_REASONS] },
          confidence: { type: "number" },
        },
        required: ["para", "from", "to", "reason"],
      },
    },
  },
  required: ["edits"],
} as const;

const editSchema = z.object({
  para: z.number().int().positive(),
  from: z.string(),
  to: z.string(),
  reason: z.enum(EDIT_REASONS),
  confidence: z.number().min(0).max(1).optional(),
});

const payloadSchema = z.object({ edits: z.array(editSchema) });

export interface Stage2Input {
  paragraphs: readonly string[];
  evidence: readonly EvidenceSpan[];
  glossary: readonly string[];
  mode: TranscriptionMode;
  /** وضع «مشروع خاص»: المراجعة محليًا */
  local?: boolean;
}

export async function proposeEdits(input: Stage2Input): Promise<ProposedEdit[]> {
  if (env().DEMO_MODE) return demoProposeEdits(input);

  const sections = [
    MODE_RULES[input.mode],
    "",
    "## النصّ، مرقّم الفقرات",
    input.paragraphs.map((p, i) => `[${i + 1}] ${p}`).join("\n\n"),
    "",
    "## المواضع المشكوك فيها",
    formatEvidence(input.evidence, input.paragraphs),
  ];

  if (input.glossary.length > 0) {
    sections.push(
      "",
      "## مسرد المشروع — الرسم الصحيح لهذه المصطلحات",
      input.glossary.map((t) => `- ${t}`).join("\n"),
    );
  }

  return callReview({
    tier: "review",
    local: input.local,
    system: SYSTEM,
    user: sections.join("\n"),
    schema: responseSchema,
    parse: (value) => payloadSchema.parse(value).edits,
  });
}
