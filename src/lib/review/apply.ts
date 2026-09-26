import { normalizeForCompare } from "@/lib/arabic";
import {
  EDIT_REASONS,
  REASONS_NEEDING_EVIDENCE,
  type AppliedEdit,
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

interface Change {
  pos: number;
  oldEnd: number;
  newLen: number;
}

const LETTER = /[\p{L}\p{N}\p{M}]/u;

export function applyEdits(
  paragraphs: readonly string[],
  edits: readonly ProposedEdit[],
  options: ApplyOptions = {},
): ApplyResult {
  const working = [...paragraphs];
  const applied: AppliedEdit[] = [];
  const rejected: RejectedEdit[] = [];

  const glossarySet = new Set(
    (options.glossary ?? []).map((t) => normalizeForCompare(t)),
  );
  const evidenceByPara = groupEvidence(options.evidence ?? []);
  /** تعديلات كل فقرة بترتيب تطبيقها — لنقل مواضع الأدلة إلى النصّ الحالي */
  const changes = new Map<number, Change[]>();
  const consumed = new Set<number>();

  const spanRange = (span: EvidenceSpan) => {
    let start = span.offset;
    let end = span.offset + span.text.length;
    for (const c of changes.get(span.para) ?? []) {
      const delta = c.newLen - (c.oldEnd - c.pos);
      if (c.oldEnd <= start) {
        start += delta;
        end += delta;
      } else if (c.pos < end) {
        start = Math.min(start, c.pos);
        end = Math.max(c.pos + c.newLen, end + delta);
      }
    }
    return { start, end };
  };

  for (const edit of edits) {
    const rejection = validate(edit, working, glossarySet, evidenceByPara);
    if (rejection) {
      rejected.push(rejection);
      continue;
    }

    const paragraph = working[edit.para - 1]!;
    const hits = occurrences(paragraph, edit.from);
    const spans = (evidenceByPara.get(edit.para) ?? []).filter((s) => !consumed.has(s.id));

    let at: number | null = null;
    let anchor: EvidenceSpan | null = null;

    if (REASONS_NEEDING_EVIDENCE.has(edit.reason)) {
      // التعديل يقع حيث قام الدليل، لا على أول تكرار للنصّ في الفقرة.
      let best = Infinity;
      for (const span of spans) {
        if (!overlaps(edit.from, span.text)) continue;
        const r = spanRange(span);
        for (const hit of hits) {
          const end = hit + edit.from.length;
          if (hit > r.end || end < r.start) continue;
          const distance = Math.abs(hit - r.start);
          if (distance < best) {
            best = distance;
            at = hit;
            anchor = span;
          }
        }
      }
      if (at === null || !anchor) {
        rejected.push({
          edit,
          code: "no_evidence",
          message: `لا دليل على «${edit.from}» في موضعه — لم يعلّمه المحرّك ولم يختلف فيه المحرّكان`,
        });
        continue;
      }

      // الدليل يبيح تغيير موضعه وحده: ما اقتبسه النموذج حوله للتعيين
      // يبقى كما هو في البديل.
      const r = spanRange(anchor);
      const before = paragraph.slice(at, Math.max(at, r.start));
      const after = paragraph.slice(Math.min(at + edit.from.length, r.end), at + edit.from.length);
      if (!edit.to.startsWith(before) || !edit.to.endsWith(after)) {
        rejected.push({
          edit,
          code: "outside_evidence",
          message: `التعديل يمسّ كلامًا خارج الموضع المشكوك فيه «${anchor.text}»`,
        });
        continue;
      }

      // أن يُسقط المحرّك الآخر كلمة لا يثبت أنها لم تُقل — Gemini يُسقط
      // كثيرًا. فالكلمة التي يُسقطها التعديل يجب أن يكون المحرّك المرجع
      // نفسه قد شكّ فيها؛ الشك في جارتها لا يبيح حذفها.
      if (edit.reason === "engine_disagreement" && wordCount(edit.to) < wordCount(edit.from)) {
        const kept = new Set(normalizeForCompare(edit.to).split(" "));
        const weak = new Set(anchor.weak ?? []);
        const lost = normalizeForCompare(edit.from)
          .split(" ")
          .filter((t) => t && !kept.has(t));
        if (lost.some((t) => !weak.has(t))) {
          rejected.push({
            edit,
            code: "drops_words",
            message: `التعديل يحذف كلامًا لم يشكّ فيه المحرّك — إسقاط المحرّك الآخر له لا يثبت أنه لم يُقل`,
          });
          continue;
        }
      }
    } else {
      at = hits[0]!;
    }

    const end = at + edit.from.length;
    working[edit.para - 1] = paragraph.slice(0, at) + edit.to + paragraph.slice(end);

    // الأدلة التي وقع عليها التعديل تُعدّ محسومة
    const spanIds: number[] = [];
    for (const span of spans) {
      const r = spanRange(span);
      if (r.start < end && r.end > at) spanIds.push(span.id);
    }
    if (anchor && !spanIds.includes(anchor.id)) spanIds.push(anchor.id);
    spanIds.forEach((id) => consumed.add(id));

    const list = changes.get(edit.para) ?? [];
    list.push({ pos: at, oldEnd: end, newLen: edit.to.length });
    changes.set(edit.para, list);

    const timed = anchor ?? spans.find((s) => spanIds.includes(s.id));
    applied.push({
      ...edit,
      at,
      spanIds,
      startMs: timed?.startMs,
      endMs: timed?.endMs,
    });
  }

  return { text: working.join("\n\n"), paragraphs: working, applied, rejected };
}

/** مواضع النصّ في الفقرة على حدود الكلمة: «من» لا تطابق داخل «منطقة». */
function occurrences(paragraph: string, needle: string): number[] {
  const out: number[] = [];
  if (!needle) return out;
  let i = paragraph.indexOf(needle);
  while (i !== -1) {
    const before = paragraph[i - 1];
    const after = paragraph[i + needle.length];
    const edgeOk = (ch: string | undefined, inner: string | undefined) =>
      !ch || !inner || !LETTER.test(ch) || !LETTER.test(inner);
    if (edgeOk(before, needle[0]) && edgeOk(after, needle[needle.length - 1])) out.push(i);
    i = paragraph.indexOf(needle, i + 1);
  }
  return out;
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

  if (!edit.from || occurrences(paragraph, edit.from).length === 0) {
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

  // السبب يصف التعديل، فيُمتحن التعديل بسببه: تصحيح الرسم لا يغيّر
  // حروف الكلمة، والترقيم لا يمسّ الكلمات، وحذف الحشو حذفٌ لا إبدال.
  // بغير هذا يصير «orthography» بابًا خلفيًا لتبديل «وش» بـ«ماذا».
  if (edit.reason === "orthography" && letters(edit.from) !== letters(edit.to)) {
    return reject("not_orthography", `«${edit.from}» ← «${edit.to}» يغيّر الكلمة لا رسمها`);
  }
  if (edit.reason === "punctuation" && bare(edit.from) !== bare(edit.to)) {
    return reject("not_punctuation", `«${edit.from}» ← «${edit.to}» يغيّر الكلمات لا الترقيم`);
  }
  if (edit.reason === "disfluency" && !isDeletionOnly(edit.from, edit.to)) {
    return reject("not_disfluency", `حذف الحشو لا يضيف كلامًا ولا يبدّله`);
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

/** حروف الكلمة بلا فروق الرسم: الهمزات والتاء المربوطة والمسافات. */
function letters(text: string): string {
  return normalizeForCompare(text).replace(/ء/g, "").replace(/\s+/g, "");
}

/** النصّ بلا ترقيم ولا مسافات زائدة — ما يبقى هو الكلمات. */
function bare(text: string): string {
  return text.replace(/[^\p{L}\p{N}\p{M}\s]/gu, "").replace(/\s+/g, " ").trim();
}

function isDeletionOnly(from: string, to: string): boolean {
  const a = normalizeForCompare(from).split(" ").filter(Boolean);
  const b = normalizeForCompare(to).split(" ").filter(Boolean);
  let i = 0;
  for (const token of a) if (token === b[i]) i++;
  return i === b.length && b.length < a.length;
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
  const after = normalizeForCompare(paragraph.split(edit.from).join(edit.to));

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
