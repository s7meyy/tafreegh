import type { ProposedEdit } from "./types";

/**
 * تصحيح المسرد الحتمي.
 *
 * «الأشكال الخاطئة» التي يكتبها المستخدم لكل مصطلح معلومةٌ سلفًا، فلا
 * داعي لسؤال نموذج عنها: تُستبدل آليًا قبل المراجعة، بلا حصة ولا
 * احتمال خطأ. وما يبقى للنموذج هو ما لا يعرفه المستخدم مسبقًا.
 *
 * المطابقة على حدود الكلمة: «عبد الله» تُصحَّح، و«عبد اللهيان» لا.
 * والسوابق الملتصقة (و، ب، ل، ف، ال) لا تُطابَق عمدًا: الإبدال الآلي
 * يجب أن يكون محافظًا، وما فاته يبقى للمراجعة.
 */

export interface GlossaryEntry {
  term: string;
  variants: readonly string[];
}

export interface GlossaryPass {
  paragraphs: string[];
  edits: ProposedEdit[];
}

const LETTER = "[\\p{L}\\p{N}\\p{M}]";

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function applyGlossaryVariants(
  paragraphs: readonly string[],
  entries: readonly GlossaryEntry[],
): GlossaryPass {
  const out = [...paragraphs];
  const edits: ProposedEdit[] = [];

  // الأطول أولًا: «عبد الله بن سعود» قبل «عبد الله»، وإلا صُحّح جزؤها
  // فلم يعد الكلّ يطابق.
  const rules = entries
    .flatMap((e) =>
      e.variants
        .map((v) => v.trim())
        .filter((v) => v && v !== e.term)
        .map((variant) => ({ variant, term: e.term })),
    )
    .sort((a, b) => b.variant.length - a.variant.length);

  for (const { variant, term } of rules) {
    const pattern = new RegExp(`(?<!${LETTER})${escape(variant)}(?!${LETTER})`, "gu");

    out.forEach((paragraph, index) => {
      const count = paragraph.match(pattern)?.length ?? 0;
      if (count === 0) return;

      out[index] = paragraph.replace(pattern, term);
      for (let k = 0; k < count; k++) {
        edits.push({ para: index + 1, from: variant, to: term, reason: "glossary", confidence: 1 });
      }
    });
  }

  return { paragraphs: out, edits };
}
