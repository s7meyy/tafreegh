/** التسميات العربية للحالات — مكان واحد، فلا تتناثر النصوص في المكوّنات. */

export const itemStatusLabel: Record<string, string> = {
  queued: "في الانتظار",
  fetching: "جارٍ الجلب",
  preparing: "التحضير",
  transcribing: "التفريغ",
  reviewing_1: "المراجعة الأولى",
  reviewing_2: "التدقيق",
  awaiting_approval: "بانتظار اعتمادك",
  approved: "معتمد",
  archived: "مؤرشف",
  failed: "فشل",
  canceled: "ملغى",
};

/** لون دلالي لكل حالة — لا نحوّل كل شيء إلى لون واحد. */
export const itemStatusTone: Record<string, string> = {
  queued: "text-ink-soft",
  fetching: "text-info",
  preparing: "text-info",
  transcribing: "text-info",
  reviewing_1: "text-info",
  reviewing_2: "text-info",
  awaiting_approval: "text-warn",
  approved: "text-ok",
  archived: "text-ink-soft",
  failed: "text-danger",
  canceled: "text-ink-soft",
};

export const transcriptionModeLabel: Record<string, string> = {
  verbatim: "حرفي",
  clean: "منقّح",
  formal: "مُفصَّح",
};

export const transcriptionModeHint: Record<string, string> = {
  verbatim: "كل ما نُطق كما نُطق، مع التلعثم والتكرار — للتوثيق والبحث",
  clean: "حذف التلعثم والحشو، وبقاء الألفاظ العامية كما هي",
  formal: "تحويل العامية إلى فصحى سليمة مع حفظ المعنى",
};

export const profileLabel: Record<string, string> = {
  free_cloud: "مجاني (Groq + Gemini)",
  local_only: "مشروع خاص — معالجة محلية فقط",
};

export const profileHint: Record<string, string> = {
  free_cloud:
    "أسرع وأدق. المقاطع تُرسل إلى مزوّدين خارجيين قد يستخدمونها في تحسين نماذجهم.",
  local_only:
    "المقطع لا يغادر خادمك أبدًا. أبطأ وأقل دقة، لكنه لا يسرّب شيئًا.",
};

export const editReasonLabel: Record<string, string> = {
  glossary: "مسرد المشروع",
  low_confidence: "ثقة منخفضة",
  engine_disagreement: "اختلاف المحرّكين",
  orthography: "رسم إملائي",
  punctuation: "ترقيم",
  disfluency: "حذف تلعثم",
};
