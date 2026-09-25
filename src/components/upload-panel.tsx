"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { uploadFile } from "@/lib/chunked-upload";

interface FileState {
  filename: string;
  sent: number;
  total: number;
  status: "uploading" | "done" | "duplicate" | "error";
  message?: string;
}

export function UploadPanel({
  projectId,
  youtubeEnabled,
}: {
  projectId: string;
  /** حقل الروابط يظهر حين تكون الميزة مفعّلة وحدها */
  youtubeEnabled: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [urls, setUrls] = useState("");
  const [files, setFiles] = useState<FileState[]>([]);
  const [error, setError] = useState<string | null>(null);

  /**
   * الملفات ترفع بالتسلسل لا بالتوازي: رفع خمسة ملفات معًا يتقاسم
   * النطاق فيبطئ كلٌّ منها، ويجعل شريط التقدّم بلا معنى.
   */
  async function uploadFiles(list: FileList | null) {
    if (!list || list.length === 0) return;

    setBusy(true);
    setError(null);

    const chosen = Array.from(list);
    setFiles(
      chosen.map((f) => ({
        filename: f.name,
        sent: 0,
        total: f.size,
        status: "uploading" as const,
      })),
    );

    const update = (index: number, patch: Partial<FileState>) =>
      setFiles((prev) =>
        prev.map((f, i) => (i === index ? { ...f, ...patch } : f)),
      );

    for (const [index, file] of chosen.entries()) {
      try {
        const outcome = await uploadFile(file, projectId, ({ sent }) =>
          update(index, { sent }),
        );
        update(index, {
          sent: file.size,
          status: outcome.duplicate ? "duplicate" : "done",
        });
      } catch (err) {
        update(index, {
          status: "error",
          message: err instanceof Error ? err.message : "فشل الرفع",
        });
      }
    }

    setBusy(false);
    router.refresh();
  }

  async function submitUrls(e: React.FormEvent) {
    e.preventDefault();
    const list = urls.split(/\s+/).map((u) => u.trim()).filter(Boolean);
    if (list.length === 0) return;

    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      for (const url of list) form.append("youtubeUrl", url);

      const res = await fetch(`/api/projects/${projectId}/items`, {
        method: "POST",
        body: form,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "تعذّر إضافة الروابط.");

      setFiles(
        (body.results ?? []).map(
          (r: { filename: string; ok: boolean; error?: string }) => ({
            filename: r.filename,
            sent: 1,
            total: 1,
            status: r.ok ? ("done" as const) : ("error" as const),
            message: r.error,
          }),
        ),
      );
      setUrls("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "حدث خطأ غير متوقع.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void uploadFiles(e.dataTransfer.files);
        }}
        className={`rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
          dragging ? "border-brand bg-brand-soft" : "border-line bg-panel"
        }`}
      >
        <p className="font-medium">{busy ? "جارٍ الرفع…" : "اسحب المقاطع هنا"}</p>
        <p className="mt-1 text-sm text-ink-soft">
          صوت أو فيديو · ملف واحد أو عدة ملفات · حتى 2 غيغابايت للملف
        </p>
        <p className="mt-1 text-sm text-ink-soft">
          الرفع مجزّأ، فالانقطاع لا يُفقد ما وصل.
        </p>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="mt-4 min-h-11 rounded-lg border border-line px-5 font-medium hover:border-brand disabled:opacity-50"
        >
          اختيار ملفات
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="audio/*,video/*"
          className="hidden"
          onChange={(e) => {
            void uploadFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {youtubeEnabled && (
        <form onSubmit={submitUrls} className="flex flex-wrap gap-2">
          <label htmlFor="yt-urls" className="sr-only">
            روابط يوتيوب
          </label>
          <textarea
            id="yt-urls"
            value={urls}
            onChange={(e) => setUrls(e.target.value)}
            rows={2}
            dir="ltr"
            placeholder="https://youtube.com/watch?v=…"
            className="min-w-64 flex-1 rounded-lg border border-line bg-panel p-3 text-sm outline-none focus:border-brand"
          />
          <button
            type="submit"
            disabled={busy || !urls.trim()}
            className="min-h-11 self-start rounded-lg border border-line px-5 font-medium hover:border-brand disabled:opacity-50"
          >
            إضافة الروابط
          </button>
        </form>
      )}

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      {files.length > 0 && (
        <ul className="space-y-2">
          {files.map((file, i) => (
            <li key={i} className="rounded-lg border border-line bg-panel p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <span className="truncate font-medium">{file.filename}</span>
                <span className={statusTone(file.status)}>
                  {statusLabel(file)}
                </span>
              </div>
              {file.status === "uploading" && (
                <div
                  className="mt-2 h-1.5 overflow-hidden rounded-full bg-brand-soft"
                  role="progressbar"
                  aria-valuenow={file.sent}
                  aria-valuemin={0}
                  aria-valuemax={file.total}
                  aria-label={`تقدّم رفع ${file.filename}`}
                >
                  <div
                    className="h-full bg-brand transition-[width]"
                    style={{ width: `${(file.sent / file.total) * 100}%` }}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function statusLabel(file: FileState): string {
  switch (file.status) {
    case "uploading":
      return `${Math.round((file.sent / file.total) * 100)}%`;
    case "done":
      return "أُضيف";
    case "duplicate":
      return "أُضيف، وهو مطابق لمقطع موجود";
    case "error":
      return file.message ?? "فشل";
  }
}

function statusTone(status: FileState["status"]): string {
  if (status === "error") return "text-danger";
  if (status === "uploading") return "text-ink-soft";
  return "text-ok";
}
