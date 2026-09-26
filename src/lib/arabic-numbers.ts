import { normalizeForCompare } from "./arabic";

/**
 * قيمة العدد المكتوب بالحروف، فصيحًا أو عاميًا.
 *
 * الغرض ضيّق: أن يُعرف أن «عشرين» و«20» شيء واحد، فلا يُعدّ اختلاف
 * المحرّكين في طريقة كتابة العدد دليلًا على خطأ في السماع. ما لا
 * يُفهم يعيد `null`، فيبقى الاختلاف دليلًا كما كان — الخطأ هنا في
 * جهة الحذر.
 */

const UNITS: Record<string, number> = {
  صفر: 0,
  واحد: 1, واحده: 1, وحده: 1,
  اثنين: 2, اثنان: 2, ثنين: 2, اثنتين: 2, اثنتان: 2,
  ثلاث: 3, ثلاثه: 3, ثلاثا: 3,
  اربع: 4, اربعه: 4,
  خمس: 5, خمسه: 5,
  ست: 6, سته: 6,
  سبع: 7, سبعه: 7,
  ثمان: 8, ثماني: 8, ثمانيه: 8, ثمنيه: 8,
  تسع: 9, تسعه: 9,
  عشر: 10, عشره: 10,
  احدعش: 11, احدعشر: 11, حدعش: 11,
  اطنعش: 12, اثنعش: 12,
  ثلطعش: 13, ثلاثطعش: 13,
  اربعطعش: 14, اربعتعش: 14,
  خمسطعش: 15, خمستعش: 15,
  ستطعش: 16, سطعش: 16,
  سبعطعش: 17, سبعتعش: 17,
  ثمنطعش: 18, ثمانطعش: 18,
  تسعطعش: 19, تسعتعش: 19,
  عشرين: 20, عشرون: 20,
  ثلاثين: 30, ثلاثون: 30,
  اربعين: 40, اربعون: 40,
  خمسين: 50, خمسون: 50,
  ستين: 60, ستون: 60,
  سبعين: 70, سبعون: 70,
  ثمانين: 80, ثمانون: 80,
  تسعين: 90, تسعون: 90,
};

const HUNDRED = /^(.*?)(ميه|مئه|مائه|ميت|مئت|مائت)$/;
const HUNDRED_DUAL = new Set(["ميتين", "مئتين", "مائتين", "ميتان", "مئتان", "مائتان"]);
const THOUSAND = new Set(["الف"]);
const THOUSAND_DUAL = new Set(["الفين", "الفان"]);
const THOUSANDS = new Set(["الاف", "الوف"]);
/** «ثلاث عشرة» و«احدى عشر» الفصيحتان */
const TEEN_TAIL = new Set(["عشر", "عشره"]);

function hundreds(token: string): number | null {
  if (HUNDRED_DUAL.has(token)) return 200;
  const m = token.match(HUNDRED);
  if (!m) return null;
  if (!m[1]) return 100;
  const unit = UNITS[m[1]];
  return unit !== undefined && unit >= 1 && unit <= 9 ? unit * 100 : null;
}

function wordValue(token: string): number | null {
  if (token in UNITS) return UNITS[token]!;
  return hundreds(token);
}

export function arabicNumberValue(text: string): number | null {
  const normalized = normalizeForCompare(text);
  if (!normalized) return null;

  const digits = normalized.replace(/[\s,٬]/g, "");
  if (/^\d+$/.test(digits)) return Number(digits);

  const tokens = normalized.split(" ");
  let total = 0;
  let current = 0;
  let seen = false;

  for (let i = 0; i < tokens.length; i++) {
    let token = tokens[i]!;
    if (token === "و") continue;

    let value = wordValue(token);
    if (value === null && token.startsWith("و")) {
      token = token.slice(1);
      value = wordValue(token);
    }

    if (value !== null) {
      // «ثلاث عشرة» = 13
      if (value < 10 && TEEN_TAIL.has(tokens[i + 1] ?? "")) {
        value += 10;
        i++;
      }
      current += value;
      seen = true;
    } else if (THOUSAND.has(token)) {
      total += (current || 1) * 1000;
      current = 0;
      seen = true;
    } else if (THOUSAND_DUAL.has(token)) {
      total += 2000;
      seen = true;
    } else if (THOUSANDS.has(token)) {
      total += (current || 3) * 1000;
      current = 0;
      seen = true;
    } else if (/^\d+$/.test(token)) {
      current += Number(token);
      seen = true;
    } else {
      return null;
    }
  }

  return seen ? total + current : null;
}

/** العبارتان عددٌ واحد بكتابتين مختلفتين. */
export function sameNumber(a: string, b: string): boolean {
  const va = arabicNumberValue(a);
  return va !== null && va === arabicNumberValue(b);
}
