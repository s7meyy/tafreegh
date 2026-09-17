import { desc, eq, sql } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db";
import { items, projects } from "@/db/schema";
import { formatCount, formatDuration } from "@/lib/format";
import { transcriptionModeLabel } from "@/lib/labels";
import { requireUser } from "@/lib/session";
import { NewProjectForm } from "@/components/new-project-form";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const user = await requireUser();

  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      description: projects.description,
      mode: projects.transcriptionMode,
      itemCount: sql<number>`count(${items.id})::int`,
      totalDuration: sql<number>`coalesce(sum(${items.durationSec}), 0)::int`,
      awaiting: sql<number>`count(*) filter (where ${items.status} = 'awaiting_approval')::int`,
    })
    .from(projects)
    .leftJoin(items, eq(items.projectId, projects.id))
    .where(eq(projects.userId, user.id))
    .groupBy(projects.id)
    .orderBy(desc(projects.createdAt));

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">المجلدات</h1>
          <p className="mt-1 text-ink-soft">
            كل مجلد مشروع مستقل، له نمط تفريغ ومسرد مصطلحات خاص به.
          </p>
        </div>
        <NewProjectForm />
      </div>

      {rows.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {rows.map((p) => (
            <li key={p.id}>
              <Link
                href={`/projects/${p.id}`}
                className="block rounded-xl border border-line bg-panel p-5 transition-colors hover:border-brand"
              >
                <div className="flex items-start justify-between gap-3">
                  <h2 className="font-semibold">{p.name}</h2>
                  {p.awaiting > 0 && (
                    <span className="shrink-0 rounded-full bg-brand-soft px-2.5 py-1 text-xs text-warn">
                      {p.awaiting} بانتظار اعتمادك
                    </span>
                  )}
                </div>

                {p.description && (
                  <p className="mt-2 line-clamp-2 text-sm text-ink-soft">
                    {p.description}
                  </p>
                )}

                <dl className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink-soft">
                  <div>{formatCount(p.itemCount, "مقطع", "مقطعان", "مقاطع")}</div>
                  <div>{formatDuration(p.totalDuration)}</div>
                  <div>نمط {transcriptionModeLabel[p.mode]}</div>
                </dl>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-line bg-panel p-10 text-center">
      <p className="font-medium">لا مجلدات بعد</p>
      <p className="mt-2 text-sm text-ink-soft">
        أنشئ مجلدًا أولًا، ثم ارفع فيه مقاطعك.
      </p>
    </div>
  );
}
