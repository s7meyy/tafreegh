/**
 * حارس التشكيل.
 *
 * التشكيل إضافة حركات لا غير. فالنصّ المشكول إذا نُزعت حركاته يجب أن
 * يعود حرفًا بحرف إلى الأصل. النموذج قد «يصحّح» كلمة وهو يشكّلها، أو
 * يحوّل العامية إلى الفصحى، أو يسقط كلمة — وكل ذلك تغيير للكلام لا
 * تشكيل له، فيُرفض.
 *
 * والرفض بالكلمة لا بالفقرة: كلمة غيّر النموذج حروفها تبقى كما كانت
 * بلا تشكيل، وجاراتها المشكولة سليمةً تُقبل.
 */

/** الحركات والتنوين والشدة والسكون والألف الخنجرية. التطويل ليس منها. */
const MARKS = /[ً-ْٰ]/g;

export function stripTashkeel(text: string): string {
  return text.replace(MARKS, "");
}

export interface GuardResult {
  text: string;
  /** كلمات أُبقيت بلا تشكيل لأن النموذج غيّر حروفها */
  rejected: number;
}

export function guardTashkeel(original: string, diacritized: string): GuardResult {
  // الأصل قد يحمل حركات من قبل (تنوين «كلامًا») — المقارنة بالحروف وحدها
  if (stripTashkeel(diacritized) === stripTashkeel(original)) {
    return { text: diacritized, rejected: 0 };
  }

  const source = original.split(/(\s+)/);
  const candidate = diacritized.trim().split(/\s+/);
  // مطابقة بالترتيب: كل كلمة من الأصل تبحث عن نظيرتها المشكولة قريبًا منها
  let cursor = 0;
  let rejected = 0;
  const out = source.map((token) => {
    if (!token.trim()) return token;
    for (let k = cursor; k < Math.min(candidate.length, cursor + 4); k++) {
      if (stripTashkeel(candidate[k]!) === stripTashkeel(token)) {
        cursor = k + 1;
        return candidate[k]!;
      }
    }
    if (/[؀-ۿ]/.test(token)) rejected++;
    return token;
  });

  return { text: out.join(""), rejected };
}
