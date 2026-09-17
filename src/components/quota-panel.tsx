import { quotaStatus, type QuotaStatus } from "@/lib/quota";

/**
 * لوحة الحصص.
 *
 * حين تكون النماذج مجانية، هذا الرقم هو ما يحدّ إنتاجك اليومي — فهو
 * أهم ما تعرضه الواجهة، لا تفصيلًا تقنيًا. ولذلك يُترجَم إلى ساعات
 * صوت، فهي وحدة عمل المستخدم لا «الطلبات».
 */
export async function QuotaPanel() {
  let rows: QuotaStatus[];
  try {
    rows = await quotaStatus();
  } catch {
    return (
      <p className="rounded-xl border border-line bg-panel p-4 text-sm text-ink-soft">
        تعذّر قراءة الحصص — تأكد أن Redis يعمل.
      </p>
    );
  }

  // النافذة اليومية وحدها هي المهمة للمستخدم؛ نوافذ الدقيقة تفصيل تشغيلي.
  const daily = rows.filter((r) => r.windowSec === 86_400);
  if (daily.length === 0) return null;

  return (
    <section className="space-y-3">
      <h2 className="font-semibold">الحصص المتبقية اليوم</h2>
      <ul className="grid gap-3 sm:grid-cols-2">
        {daily.map((row) => (
          <li
            key={`${row.provider}:${row.unit}`}
            className="rounded-xl border border-line bg-panel p-4"
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-medium">{providerLabel(row.provider)}</span>
              <span className="ltr-inline text-sm text-ink-soft">
                {row.remaining} / {row.limit}
              </span>
            </div>

            <div
              className="mt-3 h-2 overflow-hidden rounded-full bg-brand-soft"
              role="progressbar"
              aria-valuenow={row.used}
              aria-valuemin={0}
              aria-valuemax={row.limit}
              aria-label={`المستهلك من ${providerLabel(row.provider)}`}
            >
              <div
                className={`h-full ${row.remaining === 0 ? "bg-danger" : "bg-brand"}`}
                style={{ width: `${Math.min(100, (row.used / row.limit) * 100)}%` }}
              />
            </div>

            <p className="mt-2 text-sm text-ink-soft">
              {describeRemaining(row)} · يتجدّد بعد {hours(row.resetsInMs)}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function providerLabel(provider: string): string {
  const names: Record<string, string> = {
    groq: "Groq — التفريغ",
    gemini: "Gemini Flash — التفريغ والمراجعة",
    "gemini-pro": "Gemini Pro — التدقيق",
    local: "المعالجة المحلية",
  };
  return names[provider] ?? provider;
}

/** الحصة بوحدة يفهمها المستخدم: كم ساعة صوت بقيت. */
function describeRemaining(row: QuotaStatus): string {
  if (row.unit === "audioSeconds") {
    const h = row.remaining / 3600;
    if (h >= 1) return `≈ ${h.toFixed(1)} ساعة صوت`;
    return `≈ ${Math.round(row.remaining / 60)} دقيقة صوت`;
  }
  return `${row.remaining} طلب`;
}

function hours(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.round((ms % 3_600_000) / 60_000);
  if (h === 0) return `${m} دقيقة`;
  return `${h} ساعة${m > 0 ? ` و${m} دقيقة` : ""}`;
}
