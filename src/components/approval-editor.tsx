"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * محرّر الاعتماد.
 *
 * الاعتماد فعل لا رجعة فيه من ناحية الوسائط: بعده تُحذف. فالزر يطلب
 * تأكيدًا صريحًا يقول ذلك، لا «هل أنت متأكد؟» مبهمة.
 */
export function ApprovalEditor({
  itemId,
  initialText,
  approved,
  approvedAt,
}: {
  itemId: string;
  initialText: string;
  approved: boolean;
  approvedAt: string | null;
}) {
  const router = useRouter();
  const [text, setText] = useState(initialText);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const edited = text.trim() !== initialText.trim();
  const [restored, setRestored] = useState(false);
  const draftKey = `tafreegh:draft:${itemId}`;
  const loaded = useRef(false);

  // استعادة مسودة سابقة: من حرّر نصًّا طويلًا ثم أغلق التبويب خطأً لا
  // يخسر عمله. التخزين في المتصفح وحده — مسودة شخصية لا بيانات مشتركة.
  useEffect(() => {
    if (approved || loaded.current) return;
    loaded.current = true;
    try {
      const draft = localStorage.getItem(draftKey);
      if (draft && draft.trim() !== initialText.trim()) {
        setText(draft);
        setRestored(true);
      }
    } catch {
      // التخزين محجوب (تصفّح خاص مثلًا) — المحرّر يعمل بدونه.
    }
  }, [approved, draftKey, initialText]);

  // حفظ المسودة بعد توقّف الكتابة بثانية، لا مع كل حرف.
  useEffect(() => {
    if (approved || !loaded.current) return;
    const timer = setTimeout(() => {
      try {
        if (edited) localStorage.setItem(draftKey, text);
        else localStorage.removeItem(draftKey);
      } catch {}
    }, 1000);
    return () => clearTimeout(timer);
  }, [text, edited, approved, draftKey]);

  // تنبيه المتصفح عند المغادرة وفي النصّ تعديل لم يُعتمد.
  useEffect(() => {
    if (!edited || approved) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [edited, approved]);

  function discardDraft() {
    try {
      localStorage.removeItem(draftKey);
    } catch {}
    setText(initialText);
    setRestored(false);
  }

  async function approve() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/items/${itemId}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(edited ? { text } : {}),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "تعذّر الاعتماد.");
      }
      try {
        localStorage.removeItem(draftKey);
      } catch {}
      setConfirming(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "حدث خطأ غير متوقع.");
    } finally {
      setBusy(false);
    }
  }

  if (approved) {
    return (
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">النصّ المعتمد</h2>
          <span className="text-sm text-ok">اعتُمد في {approvedAt}</span>
        </div>
        <p className="whitespace-pre-wrap rounded-xl border border-line bg-panel p-5">
          {text}
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">النصّ</h2>
        {edited && (
          <span className="text-sm text-warn">فيه تعديلات لم تُعتمد · محفوظة مسودةً</span>
        )}
      </div>

      {restored && (
        <p className="flex flex-wrap items-center gap-3 rounded-lg bg-brand-soft px-4 py-2 text-sm">
          <span>استُعيدت مسودتك غير المعتمدة من آخر زيارة.</span>
          <button onClick={discardDraft} className="min-h-11 font-medium text-brand underline">
            تجاهلها وارجع للنصّ الأصلي
          </button>
        </p>
      )}

      <label htmlFor="transcript" className="sr-only">
        نصّ التفريغ
      </label>
      <textarea
        id="transcript"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={18}
        className="w-full rounded-xl border border-line bg-panel p-5 leading-loose outline-none focus:border-brand"
      />

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      {confirming ? (
        <div className="space-y-3 rounded-xl border border-warn/40 bg-panel p-5">
          <p className="font-medium">بعد الاعتماد يُحذف الصوت والفيديو.</p>
          <p className="text-sm text-ink-soft">
            يبقى النصّ وتوقيتاته، فالتصدير بكل الصيغ — ومنها بطاقات الترجمة —
            يظل متاحًا. لكن لا يمكن إعادة تفريغ المقطع بعدها.
          </p>
          <div className="flex gap-2">
            <button
              onClick={approve}
              disabled={busy}
              className="min-h-11 rounded-lg bg-brand px-5 font-medium text-white disabled:opacity-50"
            >
              {busy ? "جارٍ الاعتماد…" : "اعتمد واحذف الوسائط"}
            </button>
            <button
              onClick={() => setConfirming(false)}
              disabled={busy}
              className="min-h-11 rounded-lg px-5 text-ink-soft hover:bg-brand-soft"
            >
              تراجع
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setConfirming(true)}
          className="min-h-11 rounded-lg bg-brand px-5 font-medium text-white"
        >
          اعتماد
        </button>
      )}
    </section>
  );
}
