import { normalizeForCompare } from "@/lib/arabic";
import {
  EDIT_REASONS,
  REASONS_NEEDING_EVIDENCE,
  type ApplyResult,
  type EditReason,
  type EvidenceSpan,
  type ProposedEdit,
  type RejectedEdit,
} from "./types";

/**
 * تطبيق تعديلات المراجعة — بعد التحقق منها.
 *
 * هذه الطبقة هي الحارس. النموذج يقترح، وهي تقرّر. أي تعديل لا يجد
 * نصّه في الفقرة، أو لا سبب له من القائمة، أو يمسّ الكلام بلا دليل،
 * يُرفض ويُسجَّل سبب رفضه. النصّ الأصلي هو الافتراض، والتعديل هو ما
 * يحتاج إثباتًا — لا العكس.
 */

/** تعديل بسبب إملائي أو ترقيمي يمسّ كلمة أو كلمتين، لا جملة. */
const MAX_WORDS_WITHOUT_EVIDENCE = 3;

export interface ApplyOptions {
  /** مصطلحات المشروع — تُلزم تعديلات `glossary` بأن تنتهي إليها */
  glossary?: readonly string[];
  /** مواضع الأدلة، مبنية من الثقة واختلاف المحرّكين */
  evidence?: readonly EvidenceSpan[];
}

export function applyEdits(
  paragraphs: readonly string[],
  edits: readonly ProposedEdit[],
  options: ApplyOptions = {},
): ApplyResult {
  const working = [...paragraphs];
  const applied: ProposedEdit[] = [];
  const rejected: RejectedEdit[] = [];

  const glossarySet = new Set(
    (options.glossary ?? []).map((t) => normalizeForCompare(t)),
  );
  const evidenceByPara = groupEvidence(options.evidence ?? []);

  for (const edit of edits) {
    const rejection = validate(edit, working, glossarySet, evidenceByPara);
    if (rejection) {
      rejected.push(rejection);
      continue;
    }

    const index = edit.para - 1;
    // استبدال أول ورود فقط: التعديل يخصّ موضعًا بعينه، واستبدال كل
    // الورودات يغيّر مواضع لم يرها النموذج.
    working[index] = working[index]!.replace(edit.from, edit.to);
    applied.push(edit);
  }

  return { text: working.join("\n\n"), applied, rejected };
}

function validate(
  edit: ProposedEdit,
  paragraphs: readonly string[],
  glossary: ReadonlySet<string>,
  evidenceByPara: ReadonlyMap<number, EvidenceSpan[]>,
): RejectedEdit | null {
  const reject = (code: RejectedEdit["code"], message: string): RejectedEdit => ({
    edit,
    code,
    message,
  });

  if (!EDIT_REASONS.includes(edit.reason as EditReason)) {
    return reject("unknown_reason", `سبب غير معروف: ${edit.reason}`);
  }

  const paragraph = paragraphs[edit.para - 1];
  if (paragraph === undefined) {
    return reject("unknown_paragraph", `لا فقرة برقم ${edit.para}`);
  }

  if (edit.from === edit.to) {
    return reject("no_change", "التعديل لا يغيّر شيئًا");
  }

  if (!edit.from || !paragraph.includes(edit.from)) {
    // الخطأ الأشيع: النموذج يقتبس النصّ بتصرّف فلا يطابق الأصل.
    return reject(
      "text_not_found",
      `النصّ «${edit.from}» غير موجود في الفقرة ${edit.para}`,
    );
  }

  if (edit.reason === "glossary" && !bringsInGlossaryTerm(paragraph, edit, glossary)) {
    return reject(
      "not_in_glossary",
      `التعديل لا يُنتج أيًّا من مصطلحات المشروع، فلا يصحّ تعليله بالمسرد`,
    );
  }

  if (REASONS_NEEDING_EVIDENCE.has(edit.reason)) {
    const spans = evidenceByPara.get(edit.para) ?? [];
    if (!spans.some((span) => overlaps(edit.from, span.text))) {
      return reject(
        "no_evidence",
        `لا دليل على «${edit.from}» — لم يعلّمها المحرّك ولم يختلف فيها المحرّكان`,
      );
    }
    return null;
  }

  // بلا دليل، التعديل مقبول ما دام صغيرًا: تصحيح همزة أو ترقيم أو
  // حذف حشو. أما إعادة صياغة جملة فتحتاج دليلًا.
  const changed = Math.max(wordCount(edit.from), wordCount(edit.to));
  if (edit.reason !== "disfluency" && changed > MAX_WORDS_WITHOUT_EVIDENCE) {
    return reject(
      "too_large",
      `تعديل من ${changed} كلمات بسبب «${edit.reason}» أكبر من أن يُقبل بلا دليل`,
    );
  }

  return null;
}

/**
 * التعديل بحجّة المسرد يجب أن **يُدخل** مصطلحًا لم يكن في الفقرة.
 *
 * فحصُ أن يكون `to` نفسه مصطلحًا فحصٌ ضيّق: المصطلح «عبدالله بن سعود»
 * قد يُصحَّح بتعديل جزئي على «عبد الله» وحدها. المعيار الصحيح أثرُ
 * التعديل على الفقرة لا شكلُه.
 */
function bringsInGlossaryTerm(
  paragraph: string,
  edit: ProposedEdit,
  glossary: ReadonlySet<string>,
): boolean {
  if (glossary.size === 0) return false;

  const before = normalizeForCompare(paragraph);
  const after = normalizeForCompare(paragraph.replace(edit.from, edit.to));

  for (const term of glossary) {
    if (after.includes(term) && !before.includes(term)) return true;
  }
  return false;
}

/** تقاطع نصّي بعد التطبيع — يكفي اشتراك كلمة واحدة. */
function overlaps(a: string, b: string): boolean {
  const ta = new Set(normalizeForCompare(a).split(" ").filter(Boolean));
  if (ta.size === 0) return false;
  return normalizeForCompare(b)
    .split(" ")
    .some((token) => token !== "" && ta.has(token));
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function groupEvidence(
  spans: readonly EvidenceSpan[],
): Map<number, EvidenceSpan[]> {
  const map = new Map<number, EvidenceSpan[]>();
  for (const span of spans) {
    const list = map.get(span.para);
    if (list) list.push(span);
    else map.set(span.para, [span]);
  }
  return map;
}

/**
 * تقسيم النصّ إلى فقرات مرقّمة — وحدة التخاطب مع النموذج.
 * الترقيم يجعل التعديل يشير إلى موضع بدل أن يعيد النصّ كله، فيصغر
 * المخرَج ويسهل التحقق.
 */
export function toParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}
