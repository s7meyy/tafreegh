import { and, asc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { glossary, projects } from "@/db/schema";
import { requireUser } from "@/lib/session";
import { ProjectSettings } from "@/components/project-settings";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();

  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.userId, user.id)))
    .limit(1);

  if (!project) notFound();

  const terms = await db
    .select()
    .from(glossary)
    .where(eq(glossary.projectId, id))
    .orderBy(asc(glossary.term));

  return (
    <div className="space-y-8">
      <div>
        <Link
          href={`/projects/${project.id}`}
          className="text-sm text-ink-soft hover:text-brand"
        >
          ← {project.name}
        </Link>
        <h1 className="mt-2 text-2xl font-bold">إعدادات المجلد</h1>
      </div>

      <ProjectSettings
        projectId={project.id}
        initial={{
          name: project.name,
          transcriptionMode: project.transcriptionMode,
          profile: project.profile,
          glossary: terms.map((t) => ({
            term: t.term,
            variants: t.variants,
          })),
        }}
      />
    </div>
  );
}
