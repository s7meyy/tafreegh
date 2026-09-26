"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Word } from "@/lib/transcript/types";
import { useSpotAudio } from "./audio-spots";
import { ListenView } from "./listen-view";
import {
  clearSpots,
  LOCATE_EVENT,
  useResolvedSpots,
  type LocateRequest,
} from "@/lib/spots-store";

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
  spotIds = [],
  timed,
}: {
  itemId: string;
  initialText: string;
  approved: boolean;
  approvedAt: string | null;
  /** أرقام المواضع المشكوك فيها — لتنبيه الاعتماد بما بقي منها */
  spotIds?: number[];
  /** كلمات التفريغ بتوقيتها — تُفعّل وضع الاستماع ما دام الصوت متاحًا */
  timed?: Word[];
}) {
  const router = useRouter();
  const [text, setText] = useState(initialText);
  const [mode, setMode] = useState<"edit" | "listen">("edit");
  const { enabled: audioReady } = useSpotAudio();
  const canListen = audioReady && Boolean(timed?.length);
  const area = useRef<HTMLTextAreaElement>(null);
  const resolved = useResolvedSpots(itemId);
  const openSpots = spotIds.filter((id) => !resolved.has(id)).length;

  // «اذهب إليه» و«استبدل» من قائمة المواضع: يُحدَّد الموضع في المحرّر
  // حيث هو، لا أول تكرار لكلمته.
  useEffect(() => {
    if (approved) return;
    const onLocate = (event: Event) => {
      const request = (event as CustomEvent<LocateRequest>).detail;
      setMode("edit");
      setText((current) => {
        const hit = findSpot(current, request);
        if (!hit) return current;
        const replacement = request.replacement;
        const next =
          replacement !== undefined
            ? current.slice(0, hit.start) + replacement + current.slice(hit.end)
            : current;
        const end = replacement !== undefined ? hit.start + replacement.length : hit.end;
        requestAnimationFrame(() => select(area.current, hit.start, end, next.length));
        return next;
      });
    };
    window.addEventListener(LOCATE_EVENT, onLocate);
    return () => window.removeEventListener(LOCATE_EVENT, onLocate);
  }, [approved]);
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
      clearSpots(itemId);
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

      {canListen && (
        <div role="tablist" aria-label="طريقة المراجعة" className="flex gap-2">
          {(
            [
              ["edit", "تحرير"],
              ["listen", "استماع مع النصّ"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              role="tab"
              type="button"
              aria-selected={mode === key}
              onClick={() => setMode(key)}
              className={`min-h-11 rounded-lg px-4 ${
                mode === key ? "bg-brand-soft font-medium text-ink" : "text-ink-soft hover:bg-brand-soft"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {canListen && mode === "listen" ? (
        <ListenView
          text={text}
          timed={timed!}
          onEditAt={(start, end) => {
            setMode("edit");
            // بعد أن يُرسم المحرّر
            requestAnimationFrame(() =>
              requestAnimationFrame(() => select(area.current, start, end, text.length)),
            );
          }}
        />
      ) : (
        <>
          <label htmlFor="transcript" className="sr-only">
            نصّ التفريغ
          </label>
          <textarea
            ref={area}
            id="transcript"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={18}
            className="w-full rounded-xl border border-line bg-panel p-5 leading-loose outline-none focus:border-brand"
          />
        </>
      )}

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      {confirming ? (
        <div className="space-y-3 rounded-xl border border-warn/40 bg-panel p-5">
          {openSpots > 0 && (
            <p className="rounded-lg bg-warn/10 px-4 py-2 font-medium text-warn">
              بقي {openSpots === 1 ? "موضع مشكوك فيه لم يُراجَع" : `${openSpots} من المواضع المشكوك فيها لم تُراجَع`}.
              بعد الاعتماد يُحذف الصوت فلا يمكن الاستماع إليها.
            </p>
          )}
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
              {busy
                ? "جارٍ الاعتماد…"
                : openSpots > 0
                  ? "اعتمد على أي حال"
                  : "اعتمد واحذف الوسائط"}
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

const LABEL = /^[^\s:،.؟!]{1,24}(?: [^\s:،.؟!]{1,24}){0,2}: +/;

/**
 * موضع دليل في نصّ المحرّر: في فقرته، وأقرب ورود لنصّه إلى موضعه
 * المسجّل. إن حرّر المستخدم الفقرات فاختلف ترقيمها، فأقرب ورود في
 * النصّ كله.
 */
function findSpot(text: string, request: LocateRequest): { start: number; end: number } | null {
  const ranges: [number, number][] = [];
  const breaks = /\n\s*\n/g;
  let from = 0;
  for (let m = breaks.exec(text); m; m = breaks.exec(text)) {
    ranges.push([from, m.index]);
    from = m.index + m[0].length;
  }
  ranges.push([from, text.length]);

  const nearest = (lo: number, hi: number, expected: number) => {
    let best: number | null = null;
    for (let i = text.indexOf(request.text, lo); i !== -1 && i + request.text.length <= hi; i = text.indexOf(request.text, i + 1)) {
      if (best === null || Math.abs(i - expected) < Math.abs(best - expected)) best = i;
    }
    return best;
  };

  const range = ranges[request.para - 1];
  if (range) {
    const label = text.slice(range[0], range[1]).match(LABEL)?.[0].length ?? 0;
    const at = nearest(range[0], range[1], range[0] + label + request.offset);
    if (at !== null) return { start: at, end: at + request.text.length };
  }
  const at = nearest(0, text.length, range ? range[0] + request.offset : 0);
  return at === null ? null : { start: at, end: at + request.text.length };
}

function select(el: HTMLTextAreaElement | null, start: number, end: number, length: number) {
  if (!el) return;
  el.focus({ preventScroll: true });
  el.setSelectionRange(start, end);
  // المتصفح لا يمرّر المحرّر إلى التحديد دائمًا — نقرّبه بالنسبة.
  el.scrollTop = Math.max(0, (start / Math.max(1, length)) * el.scrollHeight - el.clientHeight / 2);
  el.scrollIntoView({ block: "nearest", behavior: "smooth" });
}
