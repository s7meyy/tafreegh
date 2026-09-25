"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * تحديث حيّ لحالة المقاطع.
 *
 * بلا هذا يبقى المقطع «في الانتظار» على الشاشة وقد انتهى، حتى يحدّث
 * المستخدم الصفحة بنفسه. التحديث يعيد جلب بيانات الخادم وحدها
 * (`router.refresh`) فلا يُفقد ما كتبه المستخدم في الحقول.
 *
 * يعمل ما دام في الصفحة ما يُعالَج، ويتوقف تلقائيًا حين لا شيء يعمل،
 * ويتوقف كذلك حين تكون الصفحة في الخلفية — لا طلبات بلا ناظر.
 */
export function AutoRefresh({
  active,
  intervalMs = 5000,
}: {
  active: boolean;
  intervalMs?: number;
}) {
  const router = useRouter();

  useEffect(() => {
    if (!active) return;

    const tick = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const timer = setInterval(tick, intervalMs);

    // العودة إلى التبويب تحدّث فورًا بدل انتظار الدورة التالية.
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [active, intervalMs, router]);

  return null;
}
