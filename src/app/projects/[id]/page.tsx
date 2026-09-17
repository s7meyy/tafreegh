import { and, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { items, projects } from "@/db/schema";
import { formatCount, formatDate, formatDuration } from "@/lib/format";
import {
  itemStatusLabel,
  itemStatusTone,
  profileLabel,
  transcriptionModeLabel,
} from "@/lib/labels";
import { getCurrentUser } from "@/lib/session";
import { UploadPanel } from "@/components/upload-panel";

export const dynamic = "force-dynamic";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();

  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.userId, user.id)))
    .limit(1);

  if (!project) notFound();

  const rows = await db
    .select()
    .from(items)
    .where(eq(items.projectId, project.id))
    .orderBy(desc(items.createdAt));

  return (
    <div className="space-y-8">
      <div>
        <Link href="/" className="text-sm text-ink-soft hover:text-brand">
          ← المجلدات
        </Link>
        <h1 className="mt-2 text-2xl font-bold">{project.name}</h1>
        <p className="mt-1 text-sm text-ink-soft">
          نمط {transcriptionModeLabel[project.transcriptionMode]} ·{" "}
          {profileLabel[project.profile]} ·{" "}
          {formatCount(rows.length, "مقطع", "مقطعان", "مقاطع")}
        </p>
      </div>

      <UploadPanel projectId={project.id} />

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line bg-panel p-10 text-center text-ink-soft">
          لا مقاطع في هذا المجلد بعد.
        </p>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-panel">
          {rows.map((item) => (
            <li key={item.id} className="flex items-center gap-4 p-4">
              <div className="min-w-0 flex-1">
                <Link
                  href={`/items/${item.id}`}
                  className="block truncate font-medium hover:text-brand"
                >
                  {item.title}
                </Link>
                <p className="mt-0.5 text-sm text-ink-soft">
                  {formatDuration(item.durationSec)} ·{" "}
                  {formatDate(item.createdAt)}
                  {item.mediaDeletedAt && " · الوسائط محذوفة"}
                </p>
                {item.errorMessage && (
                  <p className="mt-1 text-sm text-danger">
                    {item.errorMessage}
                  </p>
                )}
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
