import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { getCurrentUser } from "@/lib/session";
import { isAcceptedMedia } from "@/lib/storage";
import { CHUNK_BYTES, MAX_UPLOAD_BYTES, createSession } from "@/lib/upload-session";

const schema = z.object({
  projectId: z.string().uuid(),
  filename: z.string().min(1).max(255),
  size: z.number().int().positive().max(MAX_UPLOAD_BYTES),
  type: z.string().default(""),
});

/** فتح جلسة رفع. الملف نفسه يصل قطعًا على `PUT /api/uploads/[id]`. */
export async function POST(request: Request) {
  const user = await getCurrentUser();

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const tooBig = parsed.error.issues.some((i) => i.path[0] === "size");
    return NextResponse.json(
      {
        error: tooBig
          ? `الملف أكبر من الحدّ (${Math.round(MAX_UPLOAD_BYTES / 1024 ** 3)} غيغابايت).`
          : "بيانات غير صحيحة",
      },
      { status: 400 },
    );
  }

  const { projectId, filename, size, type } = parsed.data;

  if (!isAcceptedMedia(type, filename)) {
    return NextResponse.json({ error: "نوع الملف غير مدعوم." }, { status: 400 });
  }

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
    .limit(1);

  if (!project) {
    return NextResponse.json({ error: "المجلد غير موجود" }, { status: 404 });
  }

  const session = await createSession(projectId, filename, size);
  return NextResponse.json({ id: session.id, chunkBytes: CHUNK_BYTES }, { status: 201 });
}
