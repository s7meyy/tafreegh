import { normalizeForCompare } from "@/lib/arabic";
import type { EditVerdict } from "@/lib/review/stage3";
import type { EvidenceSpan, ProposedEdit } from "@/lib/review/types";
import { chance, demoScript } from "./script";

/**
 * مراجع ومدقّق محاكَيان لوضع العرض التجريبي.
 *
 * يحاكيان نموذجًا جيدًا غير معصوم: يصيب في أغلب المواضع المعلّمة، ويخطئ
 * في بعضها، ويقترح أحيانًا ما لا يحقّ له — تعديلًا بلا دليل، أو إعادة
 * صياغة متذرّعة بالترقيم، أو اقتباسًا بتصرّف لا يطابق النصّ. هذه
 * الأخيرة موجودة عمدًا: هي ما يُفترض أن يرفضه الحارس في `applyEdits`،
 * والعرض التجريبي يُظهر هل يرفضه فعلًا.
 *
 * «الصواب» هنا هو النصّ المرجعي، ويطّلع عليه المحاكي بدل أن يستنتجه.
 */

const PUNCT = /[،.؟!,]/g;

function referenceBetween(startMs: number, endMs: number): string {
  return demoScript()
    .filter((w) => {
      const mid = (w.startMs + w.endMs) / 2;
      return mid >= startMs - 1 && mid <= endMs + 1;
    })
    .map((w) => w.text.replace(PUNCT, ""))
    .join(" ");
}

/** أشكال الرسم الشائعة الخطأ: ما يُكتب بلا همزة أو بهاء، مأخوذًا من المرجع. */
function orthographyMap(): Map<string, string> {
  const candidates = new Map<string, Set<string>>();
  const add = (wrong: string, right: string) => {
    if (wrong === right) return;
    if (!candidates.has(wrong)) candidates.set(wrong, new Set());
    candidates.get(wrong)!.add(right);
  };

  for (const w of demoScript()) {
    const bare = w.text.replace(PUNCT, "");
    add(bare.replace(/^[أإ]/, "ا").replace(/^(ال|و|ب|ل|ف)[أإ]/, "$1ا"), bare);
    add(bare.replace(/ة$/, "ه"), bare);
  }

  // «ان» قد تكون «إن» أو «أن» — المحتمل لوجهين لا يُصحَّح آليًا.
  const map = new Map<string, string>();
  for (const [wrong, rights] of candidates) {
    if (rights.size === 1) map.set(wrong, [...rights][0]!);
  }
  return map;
}

export function demoProposeEdits(input: {
  paragraphs: readonly string[];
  evidence: readonly EvidenceSpan[];
}): ProposedEdit[] {
  const edits: ProposedEdit[] = [];

  // ١. المواضع المعلّمة
  for (const span of input.evidence) {
    if (span.startMs == null || span.endMs == null) continue;
    const ref = referenceBetween(span.startMs, span.endMs);
    const heard = span.text.replace(PUNCT, "");
    if (!ref || ref === heard) continue;

    const reason = span.kind;
    const seed = `${span.para}:${span.startMs}`;

    if (normalizeForCompare(ref) === normalizeForCompare(heard)) {
      edits.push({ para: span.para, from: heard, to: ref, reason: "orthography", confidence: 0.9 });
    } else if (chance(`rv:${seed}`) < 0.85) {
      edits.push({ para: span.para, from: heard, to: ref, reason, confidence: 0.8 });
    } else if (span.alternative && span.alternative !== heard) {
      // خطأ المراجع: يرجّح بديل المحرّك الآخر وهو خطأ أيضًا
      edits.push({ para: span.para, from: heard, to: span.alternative, reason, confidence: 0.55 });
    }
  }

  // ٢. تصحيح الرسم خارج المواضع المعلّمة — لا يلتقط النموذج كل شيء
  const map = orthographyMap();
  let budget = 40;
  input.paragraphs.forEach((paragraph, i) => {
    for (const token of paragraph.split(/\s+/)) {
      if (budget <= 0) return;
      const bare = token.replace(PUNCT, "");
      const right = map.get(bare);
      if (right && chance(`or:${i}:${bare}:${budget}`) < 0.7) {
        edits.push({ para: i + 1, from: bare, to: right, reason: "orthography", confidence: 0.9 });
        budget--;
      }
    }
  });

  // ٣. تجاوزات النموذج — يجب أن يرفضها الحارس
  const first = input.paragraphs[0] ?? "";
  const sentence = first.split(/\s+/).slice(3, 9).join(" ");
  if (sentence.split(" ").length >= 5) {
    edits.push({
      para: 1,
      from: sentence,
      to: "وهذه صياغة أجمل للجملة نفسها بأسلوب فصيح",
      reason: "punctuation",
      confidence: 0.6,
    });
  }
  const unflagged = first.split(/\s+/)[12]?.replace(PUNCT, "");
  if (unflagged) {
    edits.push({ para: 1, from: unflagged, to: "تحسين", reason: "low_confidence", confidence: 0.5 });
  }
  edits.push({ para: 1, from: "نصّ لم يرد في الفقرة إطلاقًا", to: "بديل", reason: "orthography" });

  return edits;
}

export function demoAuditEdits(edits: readonly ProposedEdit[]): EditVerdict[] {
  const reference = new Set(
    demoScript().map((w) => normalizeForCompare(w.text.replace(PUNCT, ""))),
  );
  const exact = new Set(demoScript().map((w) => w.text.replace(PUNCT, "")));

  return edits.map((edit, index) => {
    const tokens = edit.to.split(/\s+/).filter(Boolean);
    const plausible =
      tokens.length > 0 &&
      tokens.every((t) =>
        edit.reason === "orthography" ? exact.has(t) : reference.has(normalizeForCompare(t)),
      );

    // المدقّق غير معصوم: يقرّ خطأً في نحو ١٠٪ من الحالات
    if (!plausible && chance(`au:${index}:${edit.from}`) < 0.1) {
      return { index, verdict: "accept" as const, note: "إقرار خاطئ (محاكاة)" };
    }
    return plausible
      ? { index, verdict: "accept" as const }
      : { index, verdict: "reject" as const, note: "لا يطابق السياق" };
  });
}

/**
 * المداخلات من النصّ المرجعي: أول كلمات كل مداخلة في المرجع يُبحث عنها
 * في الفقرات. يحاكي نموذجًا يفهم أدوار الحوار من كلامه.
 */
export function demoInferTurns(
  paragraphs: readonly string[],
): { para: number; quote: string; speaker: number }[] {
  const script = demoScript();
  const numbers = new Map<string, number>();
  const turns: { para: number; quote: string; speaker: number }[] = [];

  // كلمات الفقرات بمواضعها، مطبَّعة للمقارنة — النموذج يقتبس من النصّ
  // الذي أمامه لا من المرجع، فالاقتباس يُؤخذ من الفقرة نفسها.
  const tokens: { para: number; start: number; end: number; norm: string }[] = [];
  paragraphs.forEach((p, i) => {
    for (const m of p.matchAll(/\S+/g)) {
      tokens.push({ para: i + 1, start: m.index!, end: m.index! + m[0].length, norm: normalizeForCompare(m[0]) });
    }
  });

  let cursor = 0;
  for (let i = 0; i < script.length; i++) {
    const w = script[i]!;
    if (i > 0 && script[i - 1]!.turn === w.turn) continue;
    if (!numbers.has(w.speaker)) numbers.set(w.speaker, numbers.size + 1);

    const want = script.slice(i, i + 3).map((x) => normalizeForCompare(x.text));
    // يُقبل تطابق كلمتين من ثلاث: في أول المداخلة قد يخطئ المحرّك
    for (let t = cursor; t < tokens.length - 2; t++) {
      const hits = want.filter((x, k) => tokens[t + k]!.norm === x).length;
      if (hits < 2 || tokens[t + 2]!.para !== tokens[t]!.para) continue;
      const first = tokens[t]!;
      const paragraph = paragraphs[first.para - 1]!;
      const quote = first.start === 0 ? "" : paragraph.slice(first.start, tokens[t + 2]!.end);
      turns.push({ para: first.para, quote, speaker: numbers.get(w.speaker)! });
      cursor = t + 1;
      break;
    }
  }
  return turns;
}

/** عنوان من أكثر كلمات المقطع دلالة — يحاكي نموذجًا يلخّص الموضوع. */
export function demoSuggestTitle(paragraphs: readonly string[]): string {
  const text = paragraphs.join(" ");
  if (text.includes("النخل") || text.includes("التمور")) return "مقابلة مع مزارع نخل من القصيم عن التمور والموسم";
  return text.split(/\s+/).slice(0, 6).join(" ");
}
