/** أسباب التعديل — قائمة مغلقة. لا سبب خارجها يُقبل (§5 من الخطة). */
export const EDIT_REASONS = [
  "glossary",
  "low_confidence",
  "engine_disagreement",
  "orthography",
  "punctuation",
  "disfluency",
] as const;

export type EditReason = (typeof EDIT_REASONS)[number];

/**
 * الأسباب التي لا تُقبل إلا فوق دليل.
 *
 * هذه هي التي تغيّر **الكلام** نفسه، فلا يُسمح بها إلا حيث قال محرّك
 * التفريغ إنه غير واثق، أو حيث اختلف المحرّكان. أما الترقيم والرسم
 * الإملائي وحذف التلعثم فلا تغيّر ما قيل، فتُقبل في أي موضع.
 *
 * هذا القيد هو ما يمنع النموذج من «تحسين» العامية إلى فصحى بالتخمين
 * (§2.1) — وهو أخطر ما يفسد التفريغ، لأنه خطأ لا يبدو خطأً.
 */
export const REASONS_NEEDING_EVIDENCE: ReadonlySet<EditReason> = new Set([
  "low_confidence",
  "engine_disagreement",
]);

export interface ProposedEdit {
  /** رقم تسلسلي يُعطى بعد الاقتراح — يربط الحكم والرفض بالتعديل نفسه */
  id?: number;
  /** رقم الفقرة، ابتداءً من 1 */
  para: number;
  from: string;
  to: string;
  reason: EditReason;
  /** ثقة النموذج في التعديل، 0..1 */
  confidence?: number;
}

export type RejectionCode =
  | "unknown_paragraph"
  | "unknown_reason"
  | "text_not_found"
  | "no_change"
  | "no_evidence"
  | "not_in_glossary"
  | "too_large"
  | "not_orthography"
  | "not_punctuation"
  | "not_disfluency"
  | "outside_evidence"
  | "drops_words";

export interface RejectedEdit {
  edit: ProposedEdit;
  code: RejectionCode;
  message: string;
}

/** تعديل طُبّق، بموضعه والأدلة التي حسمها. */
export interface AppliedEdit extends ProposedEdit {
  /** موضعه في الفقرة عند التطبيق */
  at: number;
  /** الأدلة التي وقع عليها */
  spanIds: number[];
  /** توقيت الموضع في الصوت، إن وقع على دليل */
  startMs?: number;
  endMs?: number;
}

export interface ApplyResult {
  text: string;
  paragraphs: string[];
  applied: AppliedEdit[];
  rejected: RejectedEdit[];
}

/**
 * درجة الشك: `high` اجتمع فيه الدليلان، `medium` اختلاف في السماع أو
 * ثقة متدنية جدًا، `low` كلمة أسقطها محرّك وحده أو ثقة دون الحدّ بقليل.
 */
export type Severity = "high" | "medium" | "low";

/** موضع في فقرة قام عليه دليل — تُبنى من الثقة والاختلاف. */
export interface EvidenceSpan {
  id: number;
  para: number;
  /** موضع النصّ المعلَّم في الفقرة */
  offset: number;
  /** النصّ المعلَّم كما ورد في الفقرة */
  text: string;
  kind: "low_confidence" | "engine_disagreement";
  /** بديل المحرّك الآخر، حين يكون الدليل اختلافًا */
  alternative?: string;
  /** قال المحرّك إنه غير واثق من الموضع */
  lowConfidence?: boolean;
  /** بديل مقترح للمستخدم: بديل المحرّك الآخر في مكان ما شُكّ فيه وحده */
  suggestion?: string;
  /** الكلمات التي لم يثق بها المحرّك في الموضع، مطبَّعة */
  weak?: string[];
  severity: Severity;
  startMs?: number;
  endMs?: number;
}
