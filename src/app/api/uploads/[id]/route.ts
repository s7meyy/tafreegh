import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { auditLog, items, projects } from "@/db/schema";
import { enqueuePrepare } from "@/lib/queue";
import { getCurrentUser } from "@/lib/session";
import { adoptUpload } from "@/lib/storage";
import {
  appendChunk,
  discardSession,
  finishSession,
  getSession,
} from "@/lib/upload-session";

/** حالة الجلسة — يسألها العميل ليستأنف من حيث انقطع. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession((await params).id);
  if (!session) {
    return NextResponse.json({ error: "الجلسة منتهية أو غير موجودة" }, { status: 404 });
  }
  return NextResponse.json({ received: session.received, size: session.size });
}

/**
 * استقبال قطعة.
 *
 * الجسم بايتات خام لا `FormData`: التغليف يضاعف الحجم ويحمّل الذاكرة،
 * وهو ما نتفاداه أصلًا.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await getSession(id);
  if (!session) {
    return NextResponse.json({ error: "الجلسة منتهية أو غير موجودة" }, { status: 404 });
  }

  const offset = Number(new URL(request.url).searchParams.get("offset"));
  if (!Number.isInteger(offset) || offset < 0) {
    return NextResponse.json({ error: "إزاحة غير صالحة" }, { status: 400 });
  }

  const chunk = Buffer.from(await request.arrayBuffer());
  if (chunk.length === 0) {
    return NextResponse.json({ error: "قطعة فارغة" }, { status: 400 });
  }

  const result = await appendChunk(session, offset, chunk);
  if (!result.ok) {
    // ‏409 لا ‏400: العميل يصحّح موضعه من `received` ويكمل.
    return NextResponse.json(
      { error: result.error, received: result.received },
      { status: 409 },
    );
  }

  if (!result.complete) {
    return NextResponse.json({ received: result.received, complete: false });
  }

  return complete(id);
}

/** إلغاء الرفع وحذف الملف الجزئي. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await discardSession((await params).id);
  return NextResponse.json({ ok: true });
}

/** آخر قطعة وصلت: نُنشئ المقطع وندفعه إلى الخط. */
async function complete(id: string) {
  const user = await getCurrentUser();
  const session = await getSession(id);
  if (!session) {
    return NextResponse.json({ error: "الجلسة منتهية" }, { status: 404 });
  }

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, session.projectId), eq(projects.userId, user.id)))
    .limit(1);

  if (!project) {
    await discardSession(id);
    return NextResponse.json({ error: "المجلد غير موجود" }, { status: 404 });
  }

  const { path: tempPath, hash } = await finishSession(session);

  const [existing] = await db
    .select({ id: items.id })
    .from(items)
    .where(and(eq(items.projectId, project.id), eq(items.contentHash, hash)))
    .limit(1);

  const [item] = await db
    .insert(items)
    .values({
      projectId: project.id,
      title: session.filename.replace(/\.[^.]+$/, ""),
      sourceType: "upload",
      contentHash: hash,
      status: "queued",
      currentStage: "prepare",
    })
    .returning();

  if (!item) {
    return NextResponse.json({ error: "تعذّر حفظ المقطع" }, { status: 500 });
  }

  // الملف ينتقل إلى مجلد المقطع ليشمله حذف الوسائط لاحقًا.
  const mediaPath = await adoptUpload(item.id, tempPath, session.filename);
  await db.update(items).set({ mediaPath }).where(eq(items.id, item.id));

  await db.insert(auditLog).values({
    itemId: item.id,
    action: "upload",
    actor: "user",
    detail: { filename: session.filename, bytes: session.size, chunked: true },
  });

  await enqueuePrepare(item.id);

  return NextResponse.json({
    complete: true,
    itemId: item.id,
    duplicate: Boolean(existing),
  });
}
