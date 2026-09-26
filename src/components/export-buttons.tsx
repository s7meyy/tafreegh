const FORMATS = [
  { key: "txt", label: "نصّ خام", hint: "txt" },
  { key: "docx", label: "وورد", hint: "docx" },
  { key: "md", label: "ماركداون", hint: "md" },
  { key: "srt", label: "بطاقات ترجمة", hint: "srt" },
  { key: "vtt", label: "بطاقات ويب", hint: "vtt" },
] as const;

/**
 * التصدير.
 * روابط عادية لا نداءات fetch: المتصفح يتولّى التنزيل وحده، ويعمل
 * الزرّ بالنقر الأوسط وبفتح في تبويب جديد كما يتوقّع المستخدم.
 */
export function ExportButtons({ itemId, approved }: { itemId: string; approved: boolean }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-semibold">التصدير</h2>
        {!approved && (
          <p className="mt-1 text-sm text-warn">
            لم يُعتمد النصّ بعد — ما تصدّره الآن مسودة، ويُكتب ذلك في الملف واسمه.
          </p>
        )}
      </div>
      <ul className="flex flex-wrap gap-2">
        {FORMATS.map((format) => (
          <li key={format.key}>
            <a
              href={`/api/items/${itemId}/export?format=${format.key}`}
              download
              className="flex min-h-11 items-center gap-2 rounded-lg border border-line bg-panel px-4 hover:border-brand"
            >
              <span>{format.label}</span>
              <span className="ltr-inline text-xs text-ink-soft">{format.hint}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
