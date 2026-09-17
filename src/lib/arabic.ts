/**
 * أدوات النص العربي.
 *
 * تمييز مهم: `normalizeForCompare` تُستعمل **للمقارنة فقط** — في الدمج
 * وحساب معدل الخطأ ومحاذاة المحرّكين. لا تُحفظ نتيجتها ولا تُعرض للمستخدم،
 * لأنها تُتلف الرسم الصحيح عمدًا. أما `tidyOutput` فهي التي تمسّ النص
 * المعروض، وهي محافِظة لا تغيّر كلمة.
 */

const TASHKEEL = /[ً-ْٰـ]/g; // حركات وتطويل
const NON_WORD = /[^\p{L}\p{N}\s]/gu;

/** يوحّد ما تختلف فيه المحرّكات بلا أثر على المعنى. للمقارنة فقط. */
export function normalizeForCompare(text: string): string {
  return text
    .replace(TASHKEEL, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(NON_WORD, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** تقسيم إلى كلمات بعد التطبيع — وحدة المقارنة في كل مكان. */
export function compareTokens(text: string): string[] {
  const normalized = normalizeForCompare(text);
  return normalized ? normalized.split(" ") : [];
}

/**
 * تنظيف النص المعروض: ترقيم عربي ومسافات سليمة.
 * لا يحذف كلمة ولا يبدّلها — ذلك شأن المراجعة لا التنظيف.
 */
export function tidyOutput(text: string): string {
  return (
    text
      // علامة الترقيم تلتصق بما قبلها وتُفصل عما بعدها
      .replace(/\s+([،؛؟!.:])/g, "$1")
      .replace(/([،؛؟!:])(?=\S)/g, "$1 ")
      // الترقيم اللاتيني إلى العربي داخل نص عربي
      .replace(/,/g, "،")
      .replace(/;/g, "؛")
      .replace(/\?/g, "؟")
      .replace(/[ \t]+/g, " ")
      .replace(/ *\n */g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/**
 * معدل خطأ الكلمة — مقياس الجودة في `npm run eval` (§2.5 من الخطة).
 * يُحسب بعد التطبيع، وإلا لعُدّت «هذه» و«هذة» خطأً وليستا كذلك.
 */
export function wordErrorRate(reference: string, hypothesis: string): number {
  const ref = compareTokens(reference);
  const hyp = compareTokens(hypothesis);
  if (ref.length === 0) return hyp.length === 0 ? 0 : 1;
  return editDistance(ref, hyp) / ref.length;
}

/** مسافة ليفنشتاين على مستوى الكلمات، بصفّين لا بمصفوفة كاملة. */
export function editDistance(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1]! + 1, // إدراج
        prev[j]! + 1, // حذف
        prev[j - 1]! + cost, // إبدال
      );
    }
    [prev, curr] = [curr, prev];
  }

  return prev[b.length]!;
}
