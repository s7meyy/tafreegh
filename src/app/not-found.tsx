import Link from "next/link";

/**
 * صفحة غير موجودة.
 *
 * تظهر أيضًا حين يفتح المستخدم رابط مقطع حُذف أو مجلد ليس له — والعزل
 * يردّ «غير موجود» لا «ممنوع» عمدًا، فلا يكشف وجود ما ليس له.
 */
export default function NotFound() {
  return (
    <div className="mx-auto max-w-md space-y-4 py-16 text-center">
      <p className="ltr-inline text-5xl font-bold text-ink-soft">404</p>
      <h1 className="text-2xl font-bold">الصفحة غير موجودة</h1>
      <p className="text-ink-soft">
        ربما حُذف المقطع أو المجلد، أو أن الرابط غير صحيح.
      </p>
      <Link
        href="/"
        className="inline-flex min-h-11 items-center rounded-lg bg-brand px-5 font-medium text-white"
      >
        العودة إلى المجلدات
      </Link>
    </div>
  );
}
