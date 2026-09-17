import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { items, jobs } from "@/db/schema";
import { formatDate } from "@/lib/format";
import { itemStatusLabel, itemStatusTone } from "@/lib/labels";
import { QuotaPanel } from "@/components/quota-panel";

export const dynamic = "force-dynamic";

/** لوحة المهام والحصص (§3.3). */
export default async function JobsPage() {
  const active = await db
    .select({
      id: items.id,
      title: items.title,
      status: items.status,
      stage: items.currentStage,
      createdAt: items.createdAt,
      failedJobs: sql<number>`count(*) filter (where ${jobs.state} = 'failed')::int`,
    })
    .from(items)
    .leftJoin(jobs, eq(jobs.itemId, items.id))
    .groupBy(items.id)
    .orderBy(desc(items.createdAt))
    .limit(50);

  const pending = active.filter(
    (i) => !["approved", "archived", "canceled"].includes(i.status),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">المهام والحصص</h1>
        <p className="mt-1 text-ink-soft">
          ما يعمل الآن، وما ينتظر، وما فشل ولماذا.
        </p>
      </div>

      <QuotaPanel />

      <h2 className="font-semibold">المقاطع قيد العمل</h2>
      {pending.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line bg-panel p-10 text-center text-ink-soft">
          لا مهام قيد العمل.
        </p>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-panel">
          {pending.map((item) => (
            <li key={item.id} className="flex items-center gap-4 p-4">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{item.title}</p>
                <p className="mt-0.5 text-sm text-ink-soft">
                  {formatDate(item.createdAt)}
                  {item.failedJobs > 0 && ` · ${item.failedJobs} مهمة فاشلة`}
                </p>
              </div>
              <span
                className={`shrink-0 text-sm ${itemStatusTone[item.status] ?? "text-ink-soft"}`}
              >
                {itemStatusLabel[item.status]}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
