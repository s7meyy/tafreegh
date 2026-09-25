import type { EvidenceSpan } from "@/lib/review/types";

/**
 * مواضع تحتاج نظرك (§5 المرحلة 3).
 *
 * ما شكّ فيه المحرّك أو اختلف فيه المحرّكان ولم تحسمه المراجعتان.
 * هذه هي النقاط التي يستحق فيها المستخدم أن يستمع ويقرّر بنفسه —
 * بدل أن يعيد قراءة النصّ كله بحثًا عن خطأ لا يعرف أين هو.
 */
export function UnresolvedSpans({ spans }: { spans: EvidenceSpan[] }) {
  if (spans.length === 0) return null;

  return (
    <section className="space-y-3 rounded-xl border border-warn/40 bg-panel p-5">
      <div>
        <h2 className="font-semibold">مواضع تحتاج نظرك ({spans.length})</h2>
        <p className="mt-1 text-sm text-ink-soft">
          شكّ فيها محرّك التفريغ أو اختلف فيها المحرّكان، ولم تحسمها المراجعة.
          راجعها قبل الاعتماد.
        </p>
      </div>
      <ul className="divide-y divide-line">
        {spans.map((span, i) => (
          <li key={i} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 text-sm">
            <span className="text-ink-soft">فقرة {span.para}</span>
            {span.startMs != null && (
              <span className="ltr-inline text-ink-soft">{clock(span.startMs)}</span>
            )}
            <span className="font-medium">«{span.text}»</span>
            {span.kind === "engine_disagreement" ? (
              <span className="text-ink-soft">
                المحرّك الآخر سمعها: «{span.alternative || "لا شيء"}»
              </span>
            ) : (
              <span className="text-ink-soft">ثقة المحرّك فيها منخفضة</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function clock(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}
