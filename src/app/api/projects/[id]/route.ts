import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { glossary, projects } from "@/db/schema";
import { unauthorized } from "@/lib/api";
import { requireApiUser } from "@/lib/session";

const schema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  transcriptionMode: z.enum(["verbatim", "clean", "formal"]).optional(),
  profile: z.enum(["free_cloud", "local_only"]).optional(),
  speakers: z.array(z.string().trim().min(1).max(40)).max(12).optional(),
  /** المسرد يُرسَل كاملًا ويستبدل القائمة السابقة */
  glossary: z
    .array(
      z.object({
        term: z.string().trim().min(1).max(120),
        variants: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
        note: z.string().trim().max(300).nullable().optional(),
      }),
    )
    .max(500)
    .optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const user = await requireApiUser();
  if (!user) return unauthorized();

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" },
      { status: 400 },
    );
  }

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.userId, user.id)))
    .limit(1);

  if (!project) {
    return NextResponse.json({ error: "المجلد غير موجود" }, { status: 404 });
  }

  const { glossary: terms, ...fields } = parsed.data;

  const changes = Object.fromEntries(
    Object.entries(fields).filter(([, v]) => v !== undefined),
  );
  if (Object.keys(changes).length > 0) {
    await db.update(projects).set(changes).where(eq(projects.id, id));
  }

  if (terms) {
    // استبدال كامل لا دمج: الواجهة ترسل المسرد كما يراه المستخدم،
    // والدمج يُبقي مصطلحًا حذفه.
    const unique = dedupe(terms);
    await db.delete(glossary).where(eq(glossary.projectId, id));
    if (unique.length > 0) {
      await db.insert(glossary).values(
        unique.map((t) => ({
          projectId: id,
          term: t.term,
          variants: t.variants,
          note: t.note ?? null,
        })),
      );
    }
  }

  return NextResponse.json({ ok: true });
}

/** المصطلح المكرر يكسر الفهرس الفريد؛ الأول يفوز. */
function dedupe<T extends { term: string }>(terms: T[]): T[] {
  const seen = new Set<string>();
  return terms.filter((t) => {
    if (seen.has(t.term)) return false;
    seen.add(t.term);
    return true;
  });
}
