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

/** استبدال واحد بموضعه في نصّ الفقرة **قبل** الاستبدال. */
export interface Replacement {
  start: number;
  end: number;
  text: string;
}

export interface GlossaryPass {
  paragraphs: string[];
  edits: ProposedEdit[];
  /** استبدالات كل فقرة بترتيبها — لنقل مواضع الأدلة إلى النصّ الجديد */
  replacements: Replacement[][];
}

const LETTER = "[\\p{L}\\p{N}\\p{M}]";

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function applyGlossaryVariants(
  paragraphs: readonly string[],
  entries: readonly GlossaryEntry[],
): GlossaryPass {
  // الأطول أولًا: «عبد الله بن سعود» قبل «عبد الله»، وإلا صُحّح جزؤها
  // فلم يعد الكلّ يطابق. والتمرير واحد بكل الأشكال معًا، فلا يعود
  // شكلٌ قصير فيطابق داخل مصطلح استُبدل للتوّ.
  const rules = new Map<string, string>();
  for (const e of entries) {
    for (const raw of e.variants) {
      const v = raw.trim();
      if (v && v !== e.term && !rules.has(v)) rules.set(v, e.term);
    }
  }

  const empty: GlossaryPass = {
    paragraphs: [...paragraphs],
    edits: [],
    replacements: paragraphs.map(() => []),
  };
  if (rules.size === 0) return empty;

  const alternatives = [...rules.keys()].sort((a, b) => b.length - a.length).map(escape);
  const pattern = new RegExp(`(?<!${LETTER})(?:${alternatives.join("|")})(?!${LETTER})`, "gu");

  const edits: ProposedEdit[] = [];
  const replacements: Replacement[][] = [];

  const out = paragraphs.map((paragraph, index) => {
    const list: Replacement[] = [];
    const next = paragraph.replace(pattern, (match: string, offset: number) => {
      const term = rules.get(match)!;
      list.push({ start: offset, end: offset + match.length, text: term });
      edits.push({ para: index + 1, from: match, to: term, reason: "glossary", confidence: 1 });
      return term;
    });
    replacements.push(list);
    return next;
  });

  return { paragraphs: out, edits, replacements };
}

/**
 * نقل موضع من النصّ قبل استبدالات المسرد إلى ما بعدها.
 * الموضع الواقع داخل نصّ استُبدل يُعاد `null`: المسرد حسمه.
 */
export function mapThroughReplacements(
  list: readonly Replacement[],
  start: number,
  end: number,
): { start: number; end: number } | null {
  let shift = 0;
  for (const r of list) {
    if (r.end <= start) {
      shift += r.text.length - (r.end - r.start);
      continue;
    }
    if (r.start >= end) break;
    return null;
  }
  return { start: start + shift, end: end + shift };
}
