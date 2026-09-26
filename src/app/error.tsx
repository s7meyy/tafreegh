"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * خطأ غير متوقع في صفحة.
 *
 * أشيع أسبابه انقطاع قاعدة البيانات أو إعادة تشغيل الخادم. رسالة
 * بالعربية وزرّ إعادة محاولة أنفع من صفحة 500 إنجليزية فارغة، ولا
 * تُعرض تفاصيل الخطأ للمستخدم — مكانها سجلّ الخادم.
 */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-md space-y-4 py-16 text-center">
      <h1 className="text-2xl font-bold">تعذّر عرض الصفحة</h1>
      <p className="text-ink-soft">
        حدث خطأ في الخادم — غالبًا انقطاع مؤقت في الاتصال بقاعدة البيانات.
        نصوصك محفوظة. أعد المحاولة بعد لحظات.
      </p>
      {error.digest && (
        <p className="text-sm text-ink-soft">
          رمز الخطأ للدعم: <span className="ltr-inline">{error.digest}</span>
        </p>
      )}
      <div className="flex flex-wrap justify-center gap-2">
        <button
          onClick={reset}
          className="inline-flex min-h-11 items-center rounded-lg bg-brand px-5 font-medium text-white"
        >
          أعد المحاولة
        </button>
        <Link
          href="/"
          className="inline-flex min-h-11 items-center rounded-lg border border-line px-5"
        >
          العودة إلى المجلدات
        </Link>
      </div>
    </div>
  );
}
