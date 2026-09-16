"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

type Result =
  | { filename: string; ok: true; itemId: string; duplicate: boolean }
  | { filename: string; ok: false; error: string };

export function UploadPanel({ projectId }: { projectId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [urls, setUrls] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function send(form: FormData) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/items`, {
        method: "POST",
        body: form,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "تعذّر الرفع.");
      setResults(body.results ?? []);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "حدث خطأ غير متوقع.");
    } finally {
      setBusy(false);
    }
  }

  function uploadFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const form = new FormData();
    for (const file of Array.from(files)) form.append("files", file);
    void send(form);
  }

  function submitUrls(e: React.FormEvent) {
    e.preventDefault();
    const list = urls
      .split(/\s+/)
      .map((u) => u.trim())
      .filter(Boolean);
    if (list.length === 0) return;
    const form = new FormData();
    for (const url of list) form.append("youtubeUrl", url);
    void send(form).then(() => setUrls(""));
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
          uploadFiles(e.dataTransfer.files);
        }}
        className={`rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
          dragging ? "border-brand bg-brand-soft" : "border-line bg-panel"
        }`}
      >
        <p className="font-medium">
          {busy ? "جارٍ الرفع…" : "اسحب المقاطع هنا"}
        </p>
        <p className="mt-1 text-sm text-ink-soft">
          صوت أو فيديو · ملف واحد أو عدة ملفات · حتى 200 ميغابايت للملف
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
            uploadFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

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

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      {results.length > 0 && (
        <ul className="space-y-1 text-sm">
          {results.map((r, i) => (
            <li
              key={i}
              className={r.ok ? "text-ok" : "text-danger"}
            >
              <span className="text-ink">{r.filename}</span>
              {" — "}
              {r.ok
                ? r.duplicate
                  ? "أُضيف، وهو مطابق لمقطع موجود في المجلد"
                  : "أُضيف"
                : r.error}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
