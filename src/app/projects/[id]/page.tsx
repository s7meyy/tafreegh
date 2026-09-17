import { and, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { items, projects } from "@/db/schema";
import { formatCount } from "@/lib/format";
import { profileLabel, transcriptionModeLabel } from "@/lib/labels";
import { getCurrentUser } from "@/lib/session";
import { ItemList, type ItemRow } from "@/components/item-list";
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

  const found = await db
    .select()
    .from(items)
    .where(eq(items.projectId, project.id))
    .orderBy(desc(items.createdAt));

  const rows: ItemRow[] = found.map((item) => ({
    id: item.id,
    title: item.title,
    status: item.status,
    durationSec: item.durationSec,
    createdAt: item.createdAt.toISOString(),
    mediaDeleted: Boolean(item.mediaDeletedAt),
    errorMessage: item.errorMessage,
  }));

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
        <ItemList projectId={project.id} rows={rows} />
      )}
    </div>
  );
}
