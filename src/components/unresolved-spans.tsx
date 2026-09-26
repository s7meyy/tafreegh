"use client";

import { clock } from "@/lib/format";
import type { EvidenceSpan } from "@/lib/review/types";
import { locate, markSpot, useResolvedSpots } from "@/lib/spots-store";
import { PlayButton } from "./audio-spots";

/**
 * مواضع تحتاج نظرك (§5 المرحلة 3).
 *
 * ما شكّ فيه المحرّك أو اختلف فيه المحرّكان ولم تحسمه المراجعتان.
 * تُرتَّب بدرجة الشك ثم بالوقت: الأولى بالنظر ظاهرة، والأقل شكًّا
 * مطويّة — قائمة طويلة متساوية يتعلّم المستخدم تجاهلها كلها، ومعها
 * القليل الذي يستحق.
 *
 * كل موضع يُسمع ويُذهب إليه في المحرّر ويُستبدل بما سمعه المحرّك
 * الآخر بنقرة، أو يُعلَّم «سليم».
 */
export function UnresolvedSpans({ itemId, spans }: { itemId: string; spans: EvidenceSpan[] }) {
  const resolved = useResolvedSpots(itemId);
  if (spans.length === 0) return null;

  // المواضع المحفوظة من تشغيل قديم بلا رقم ولا درجة تأخذ رقمها بالترتيب
  const list = spans
    .map((s, i) => ({ ...s, id: s.id ?? i + 1, severity: s.severity ?? "medium" }))
    .sort((a, b) => (a.startMs ?? 0) - (b.startMs ?? 0));

  // الأشد شكًّا أولًا — اجتمع فيه الدليلان — ثم البقية بترتيب الوقت
  const primary = [
    ...list.filter((s) => s.severity === "high"),
    ...list.filter((s) => s.severity === "medium"),
  ];
  const minor = list.filter((s) => s.severity === "low");
  const open = list.filter((s) => !resolved.has(s.id)).length;

  return (
    <section className="space-y-4 rounded-xl border border-warn/40 bg-panel p-5">
      <div>
        <h2 className="font-semibold">
          مواضع تحتاج نظرك{" "}
          <span className="text-ink-soft">
            ({open} من {list.length} باقية)
          </span>
        </h2>
        <p className="mt-1 text-sm text-ink-soft">
          شكّ فيها محرّك التفريغ أو اختلف فيها المحرّكان، ولم تحسمها المراجعة
          لأنها لم تسمع الصوت. استمع إلى كل موضع، ثم استبدله أو علّمه سليمًا.
        </p>
      </div>

      {primary.length > 0 ? (
        <SpanList itemId={itemId} spans={primary} resolved={resolved} />
      ) : (
        <p className="text-sm text-ok">لا مواضع شديدة الشك.</p>
      )}

      {minor.length > 0 && (
        <details className="rounded-lg border border-line">
          <summary className="flex min-h-11 cursor-pointer items-center px-4 text-sm">
            مواضع أقلّ شكًّا ({minor.length}) — كلمة أسقطها أحد المحرّكين، أو ثقة
            دون الحدّ بقليل
          </summary>
          <div className="border-t border-line px-4">
            <SpanList itemId={itemId} spans={minor} resolved={resolved} />
          </div>
        </details>
      )}
    </section>
  );
}

function SpanList({
  itemId,
  spans,
  resolved,
}: {
  itemId: string;
  spans: EvidenceSpan[];
  resolved: ReadonlySet<number>;
}) {
  return (
    <ul className="divide-y divide-line">
      {spans.map((span) => {
        const done = resolved.has(span.id);
        const target = { para: span.para, text: span.text, offset: span.offset ?? 0 };
        // بديل يحذف كلامًا لم يُشكّ فيه لا يُقترح؛ المواضع القديمة بلا
        // اقتراح تأخذ بديل المحرّك الآخر إن قابلها كلمةً بكلمة.
        const suggestion =
          span.kind !== "engine_disagreement"
            ? undefined
            : "suggestion" in span
              ? span.suggestion
              : span.alternative &&
                  span.alternative.split(/\s+/).length >= span.text.split(/\s+/).length
                ? span.alternative
                : undefined;
        return (
          <li
            key={span.id}
            className={`flex flex-wrap items-center gap-x-3 gap-y-2 py-2 text-sm ${done ? "opacity-50" : ""}`}
          >
            {span.startMs != null && (
              <span className="ltr-inline w-14 text-ink-soft">{clock(span.startMs)}</span>
            )}
            <span className="font-medium">«{span.text}»</span>
            <span className="text-ink-soft">
              {span.kind === "engine_disagreement"
                ? span.alternative
                  ? `المحرّك الآخر سمعها: «${span.alternative}»`
                  : "لم يسمعها المحرّك الآخر"
                : "ثقة المحرّك فيها منخفضة"}
              {span.severity === "high" && (
                <strong className="font-medium text-warn"> · والمحرّك نفسه غير واثق</strong>
              )}
            </span>

            <span className="ms-auto flex flex-wrap gap-2">
              <PlayButton spot={`span-${span.id}`} startMs={span.startMs} endMs={span.endMs} />
              <button
                type="button"
                onClick={() => locate(target)}
                className="min-h-11 rounded-lg border border-line px-3 hover:border-brand"
              >
                اذهب إليه
              </button>
              {suggestion && !done && (
                <button
                  type="button"
                  onClick={() => {
                    locate({ ...target, replacement: suggestion });
                    markSpot(itemId, span.id, true);
                  }}
                  className="min-h-11 rounded-lg border border-line px-3 hover:border-brand"
                >
                  استبدل بـ«{suggestion}»
                </button>
              )}
              <button
                type="button"
                onClick={() => markSpot(itemId, span.id, !done)}
                aria-pressed={done}
                className="min-h-11 rounded-lg px-3 text-ink-soft hover:bg-brand-soft"
              >
                {done ? "أعِده" : "سليم"}
              </button>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
