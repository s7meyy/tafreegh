"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * إجراءات المقطع: إعادة المحاولة، وإعادة التسمية، والحذف.
 *
 * بلا إعادة المحاولة، المقطع الفاشل يبقى عالقًا لا مخرج له إلا حذفه
 * ورفعه من جديد — وهو ما يُفقد ما أُنجز منه ويُنفق الحصة ثانيةً.
 */
export function ItemActions({
  itemId,
  title,
  failed,
}: {
  itemId: string;
  title: string;
  failed: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"idle" | "rename" | "delete">("idle");
  const [name, setName] = useState(title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(method: "PATCH" | "DELETE", body?: object) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/items/${itemId}`, {
        method,
        headers: { "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "تعذّر تنفيذ الطلب.");
      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : "حدث خطأ غير متوقع.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function retry() {
    if (await call("PATCH", { retry: true })) router.refresh();
  }

  async function rename(e: React.FormEvent) {
    e.preventDefault();
    if (await call("PATCH", { title: name })) {
      setMode("idle");
      router.refresh();
    }
  }

  async function remove() {
    const data = await call("DELETE");
    if (data) router.push(`/projects/${data.projectId}`);
  }

  const button =
    "min-h-11 rounded-lg border border-line px-4 text-sm hover:border-brand disabled:opacity-50";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {failed && (
          <button
            onClick={retry}
            disabled={busy}
            className="min-h-11 rounded-lg bg-brand px-4 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? "لحظة…" : "إعادة المحاولة"}
          </button>
        )}
        <button onClick={() => setMode("rename")} disabled={busy} className={button}>
          إعادة التسمية
        </button>
        <button
          onClick={() => setMode("delete")}
          disabled={busy}
          className="min-h-11 rounded-lg px-4 text-sm text-danger hover:bg-danger/10 disabled:opacity-50"
        >
          حذف
        </button>
      </div>

      {mode === "rename" && (
        <form onSubmit={rename} className="flex flex-wrap gap-2">
          <label htmlFor="item-title" className="sr-only">
            العنوان الجديد
          </label>
          <input
            id="item-title"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={200}
            autoFocus
            className="min-h-11 min-w-64 flex-1 rounded-lg border border-line bg-panel px-4 outline-none focus:border-brand"
          />
          <button type="submit" disabled={busy || !name.trim()} className={button}>
            حفظ
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("idle");
              setName(title);
            }}
            className="min-h-11 rounded-lg px-4 text-sm text-ink-soft hover:bg-brand-soft"
          >
            إلغاء
          </button>
        </form>
      )}

      {mode === "delete" && (
        <div className="space-y-3 rounded-xl border border-danger/40 bg-panel p-4">
          <p className="font-medium">حذف «{title}» نهائيًا، بنصوصه ووسائطه؟</p>
          <p className="text-sm text-ink-soft">لا يمكن التراجع عن هذا.</p>
          <div className="flex gap-2">
            <button
              onClick={remove}
              disabled={busy}
              className="min-h-11 rounded-lg bg-danger px-5 text-sm font-medium text-white disabled:opacity-50"
            >
              {busy ? "جارٍ الحذف…" : "احذف"}
            </button>
            <button
              onClick={() => setMode("idle")}
              className="min-h-11 rounded-lg px-5 text-sm text-ink-soft hover:bg-brand-soft"
            >
              تراجع
            </button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
