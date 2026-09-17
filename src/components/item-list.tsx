"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatDate, formatDuration } from "@/lib/format";
import { itemStatusLabel, itemStatusTone } from "@/lib/labels";

export interface ItemRow {
  id: string;
  title: string;
  status: string;
  durationSec: number | null;
  createdAt: string;
  mediaDeleted: boolean;
  errorMessage: string | null;
}

const FORMATS = [
  { key: "txt", label: "نصّ خام" },
  { key: "docx", label: "وورد" },
  { key: "md", label: "ماركداون" },
  { key: "srt", label: "بطاقات ترجمة" },
] as const;

export function ItemList({
  projectId,
  rows,
}: {
  projectId: string;
  rows: ItemRow[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allSelected = rows.length > 0 && selected.size === rows.length;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function exportSelected(format: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/export`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ itemIds: [...selected], format }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "تعذّر التصدير.");
      }

      // الملف المضغوط يُبنى في الذاكرة ثم يُنزَّل برابط مؤقت.
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filenameFrom(res) ?? "تفريغ.zip";
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "حدث خطأ غير متوقع.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteSelected() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/items/delete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ itemIds: [...selected] }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "تعذّر الحذف.");
      }
      setSelected(new Set());
      setConfirmDelete(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "حدث خطأ غير متوقع.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={() =>
              setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))
            }
            className="accent-brand"
          />
          <span>تحديد الكل</span>
        </label>

        {selected.size > 0 && (
          <>
            <span className="text-sm text-ink-soft">
              {selected.size} محدّد
            </span>
            {FORMATS.map((format) => (
              <button
                key={format.key}
                onClick={() => void exportSelected(format.key)}
                disabled={busy}
                className="min-h-11 rounded-lg border border-line px-4 text-sm hover:border-brand disabled:opacity-50"
              >
                {format.label}
              </button>
            ))}
            <button
              onClick={() => setConfirmDelete(true)}
              disabled={busy}
              className="min-h-11 rounded-lg px-4 text-sm text-danger hover:bg-danger/10 disabled:opacity-50"
            >
              حذف
            </button>
          </>
        )}
      </div>

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      {confirmDelete && (
        <div className="space-y-3 rounded-xl border border-danger/40 bg-panel p-5">
          <p className="font-medium">
            حذف {selected.size} مقطعًا نهائيًا، بنصوصها ووسائطها؟
          </p>
          <p className="text-sm text-ink-soft">لا يمكن التراجع عن هذا.</p>
          <div className="flex gap-2">
            <button
              onClick={() => void deleteSelected()}
              disabled={busy}
              className="min-h-11 rounded-lg bg-danger px-5 font-medium text-white disabled:opacity-50"
            >
              {busy ? "جارٍ الحذف…" : "احذف"}
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              disabled={busy}
              className="min-h-11 rounded-lg px-5 text-ink-soft hover:bg-brand-soft"
            >
              تراجع
            </button>
          </div>
        </div>
      )}

      <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-panel">
        {rows.map((item) => (
          <li key={item.id} className="flex items-center gap-3 p-4">
            <input
              type="checkbox"
              checked={selected.has(item.id)}
              onChange={() => toggle(item.id)}
              aria-label={`تحديد ${item.title}`}
              className="size-4 shrink-0 accent-brand"
            />
            <div className="min-w-0 flex-1">
              <Link
                href={`/items/${item.id}`}
                className="block truncate font-medium hover:text-brand"
              >
                {item.title}
              </Link>
              <p className="mt-0.5 text-sm text-ink-soft">
                {formatDuration(item.durationSec)} · {formatDate(item.createdAt)}
                {item.mediaDeleted && " · الوسائط محذوفة"}
              </p>
              {item.errorMessage && (
                <p className="mt-1 text-sm text-danger">{item.errorMessage}</p>
              )}
            </div>
            <span
              className={`shrink-0 text-sm ${itemStatusTone[item.status] ?? "text-ink-soft"}`}
            >
              {itemStatusLabel[item.status]}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function filenameFrom(res: Response): string | null {
  const header = res.headers.get("content-disposition") ?? "";
  const match = header.match(/filename\*=UTF-8''([^;]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}
