"use client";

/**
 * خطأ في الهيكل نفسه (layout) — لا يُعرض فيه شيء من الموقع، فيحمل
 * صفحته كاملة بأبسط تنسيق.
 */
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="ar" dir="rtl">
      <body style={{ fontFamily: "system-ui, sans-serif", background: "#faf9f6", color: "#1c1b19" }}>
        <div style={{ maxWidth: 420, margin: "96px auto", padding: 16, textAlign: "center", lineHeight: 1.85 }}>
          <h1 style={{ fontSize: 24 }}>تعذّر تشغيل الموقع</h1>
          <p>حدث خطأ في الخادم. نصوصك محفوظة — أعد المحاولة بعد لحظات.</p>
          <button
            onClick={reset}
            style={{ minHeight: 44, padding: "0 20px", borderRadius: 8, border: 0, background: "#0f766e", color: "#fff", fontSize: 16 }}
          >
            أعد المحاولة
          </button>
        </div>
      </body>
    </html>
  );
}
