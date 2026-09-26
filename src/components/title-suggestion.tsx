"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** عنوان مقترح من محتوى المقطع — بنقرة يصير العنوان، أو يُتجاهل. */
export function TitleSuggestion({ itemId, suggestion }: { itemId: string; suggestion: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;

  async function send(body: object) {
    setBusy(true);
    try {
      const res = await fetch(`/api/items/${itemId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setHidden(true);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <p className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-brand-soft px-4 py-2 text-sm">
      <span>عنوان مقترح من المحتوى: «{suggestion}»</span>
      <button
        onClick={() => send({ title: suggestion })}
        disabled={busy}
        className="min-h-11 rounded-lg px-3 font-medium text-brand underline disabled:opacity-50"
      >
        اعتمده عنوانًا
      </button>
      <button
        onClick={() => send({ dismissTitle: true })}
        disabled={busy}
        className="min-h-11 rounded-lg px-3 text-ink-soft disabled:opacity-50"
      >
        تجاهله
      </button>
    </p>
  );
}
