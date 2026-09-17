import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { unauthorized } from "@/lib/api";
import { requireApiUser } from "@/lib/session";

const createSchema = z.object({
  name: z.string().trim().min(1, "الاسم مطلوب").max(120),
  description: z.string().trim().max(1000).optional(),
  transcriptionMode: z.enum(["verbatim", "clean", "formal"]).default("clean"),
  profile: z.enum(["free_cloud", "local_only"]).default("free_cloud"),
});

export async function POST(request: Request) {
  const user = await requireApiUser();
  if (!user) return unauthorized();

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" },
      { status: 400 },
    );
  }

  const [project] = await db
    .insert(projects)
    .values({ ...parsed.data, userId: user.id })
    .returning();

  return NextResponse.json(project, { status: 201 });
}
