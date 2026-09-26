"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { clock } from "@/lib/format";
import type { Enrichment, EnrichKind, TashkeelMode } from "@/lib/enrich/types";
import { PlayButton } from "./audio-spots";

/**
 * الملخص والتشكيل.
 *
 * كلاهما يُطلب بنقرة ويعمل في الخلفية، والصفحة تتحدّث وحدها حتى يتمّ.
 * ويُنبَّه المستخدم إن تغيّر النصّ بعد إنشائهما: ملخصٌ لنصٍّ غير الذي
 * أمامه قد يذكر ما صُحّح.
 */
export function EnrichPanel({
  itemId,
  enrichment,
  source,
}: {
  itemId: string;
  enrichment: Enrichment;
  /** بصمة النصّ الحالي */
  source: string;
}) {
  return (
    <section className="grid gap-4 md:grid-cols-2">
      <SummaryCard itemId={itemId} state={enrichment.summary} source={source} />
      <TashkeelCard itemId={itemId} state={enrichment.tashkeel} source={source} />
    </section>
  );
}

function useRequest(itemId: string) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function request(kind: EnrichKind, mode?: TashkeelMode) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/items/${itemId}/enrich`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, mode }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "تعذّر الطلب.");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "حدث خطأ غير متوقع.");
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, request };
}

function Status({
  status,
  error,
  stale,
  progress,
}: {
  status?: string;
  error?: string;
  stale: boolean;
  progress?: string;
}) {
  if (status === "queued") return <p className="text-sm text-info">في الطابور…</p>;
  if (status === "running")
    return <p className="text-sm text-info">جارٍ العمل{progress ? ` — ${progress}` : "…"}</p>;
  if (status === "failed")
    return (
      <p role="alert" className="text-sm text-danger">
        تعذّر: {error}
      </p>
    );
  if (status === "done" && stale)
    return (
      <p className="text-sm text-warn">تغيّر النصّ بعد إنشائه — أعد الإنشاء ليوافق النصّ الحالي.</p>
    );
  return null;
}

function SummaryCard({
  itemId,
  state,
  source,
}: {
  itemId: string;
  state: Enrichment["summary"];
  source: string;
}) {
  const { busy, error, request } = useRequest(itemId);
  const working = state?.status === "queued" || state?.status === "running";
  const data = state?.data;

  return (
    <div className="space-y-3 rounded-xl border border-line bg-panel p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">الملخص</h2>
        <button
          type="button"
          onClick={() => request("summary")}
          disabled={busy || working}
          className="min-h-11 rounded-lg border border-line px-4 hover:border-brand disabled:opacity-50"
        >
          {data ? "أعد التلخيص" : "لخّص المقطع"}
        </button>
      </div>
      <Status status={state?.status} error={state?.error} stale={Boolean(data) && state?.source !== source} />
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      {data ? (
        <div className="space-y-3">
          <p>{data.brief}</p>
          {data.points.length > 0 && (
            <ul className="space-y-2">
              {data.points.map((point, i) => (
                <li key={i} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  <span className="flex-1">{point.text}</span>
                  {point.startMs != null && (
                    <span className="ltr-inline text-ink-soft">{clock(point.startMs)}</span>
                  )}
                  <PlayButton
                    spot={`point-${i}`}
                    startMs={point.startMs}
                    endMs={point.startMs != null ? point.startMs + 15_000 : null}
                  />
                </li>
              ))}
            </ul>
          )}
          {data.topics.length > 0 && (
            <ul className="flex flex-wrap gap-2" aria-label="الموضوعات">
              {data.topics.map((t) => (
                <li key={t} className="rounded-full bg-brand-soft px-3 py-1 text-sm">
                  {t}
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-ink-soft">
            ملخص آلي من النصّ وحده. كل نقطة مسندة إلى موضعها — استمع إليه قبل الاعتماد عليها.
          </p>
        </div>
      ) : (
        !working && (
          <p className="text-sm text-ink-soft">
            خلاصة قصيرة وأهم النقاط بمواضعها في التسجيل، والموضوعات الرئيسة.
          </p>
        )
      )}
    </div>
  );
}

function TashkeelCard({
  itemId,
  state,
  source,
}: {
  itemId: string;
  state: Enrichment["tashkeel"];
  source: string;
}) {
  const { busy, error, request } = useRequest(itemId);
  const [mode, setMode] = useState<TashkeelMode>(state?.mode ?? "full");
  const [copied, setCopied] = useState(false);
  const working = state?.status === "queued" || state?.status === "running";
  const text = state?.status === "done" ? state.text : undefined;
  const progress =
    state?.total && state.done ? `${state.done.length} من ${state.total} فقرة` : undefined;

  return (
    <div className="space-y-3 rounded-xl border border-line bg-panel p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">التشكيل</h2>
        <div className="flex flex-wrap gap-2">
          <label className="sr-only" htmlFor="tashkeel-mode">
            نمط التشكيل
          </label>
          <select
            id="tashkeel-mode"
            value={mode}
            onChange={(e) => setMode(e.target.value as TashkeelMode)}
            disabled={working}
            className="min-h-11 rounded-lg border border-line bg-panel px-2"
          >
            <option value="full">تشكيل كامل</option>
            <option value="light">ما يلتبس وحده</option>
          </select>
          <button
            type="button"
            onClick={() => request("tashkeel", mode)}
            disabled={busy || working}
            className="min-h-11 rounded-lg border border-line px-4 hover:border-brand disabled:opacity-50"
          >
            {text ? "أعد التشكيل" : "شكّل النصّ"}
          </button>
        </div>
      </div>
      <Status
        status={state?.status}
        error={state?.error}
        stale={Boolean(text) && state?.source !== source}
        progress={progress}
      />
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      {text ? (
        <>
          <details>
            <summary className="flex min-h-11 cursor-pointer items-center">
              النصّ المشكول ({state?.mode === "light" ? "ما يلتبس" : "كامل"})
            </summary>
            <p className="mt-2 max-h-96 overflow-y-auto whitespace-pre-wrap rounded-lg bg-surface p-4 text-lg leading-[2.2]">
              {text}
            </p>
          </details>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(text).catch(() => {});
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="min-h-11 rounded-lg border border-line px-4 hover:border-brand"
            >
              {copied ? "نُسخ" : "انسخ النصّ المشكول"}
            </button>
            {(state?.rejectedWords ?? 0) > 0 && (
              <span className="text-ink-soft">
                {state!.rejectedWords} كلمة بقيت بلا تشكيل: غيّر النموذج حروفها فرُدّ تشكيلها.
              </span>
            )}
          </div>
        </>
      ) : (
        !working && (
          <p className="text-sm text-ink-soft">
            حركات تُضاف إلى النصّ دون تغيير حرف منه — يُرفض آليًا كل تشكيل يغيّر الكلمة.
            أدقّ ما يكون في الفصحى؛ والعامية تُشكَّل كما تُنطق.
          </p>
        )
      )}
    </div>
  );
}
