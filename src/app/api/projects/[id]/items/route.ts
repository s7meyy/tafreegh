import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { auditLog, items, projects } from "@/db/schema";
import { env } from "@/lib/env";
import { getCurrentUser } from "@/lib/session";
import { MAX_UPLOAD_BYTES, isAcceptedMedia, saveMedia } from "@/lib/storage";

type Result =
  | { filename: string; ok: true; itemId: string; duplicate: boolean }
  | { filename: string; ok: false; error: string };

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  const user = await getCurrentUser();

  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
    .limit(1);

  if (!project) {
    return NextResponse.json({ error: "المجلد غير موجود" }, { status: 404 });
  }

  const form = await request.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: "طلب غير صالح" }, { status: 400 });
  }

  const results: Result[] = [];

  for (const url of form.getAll("youtubeUrl")) {
    if (typeof url !== "string" || !url.trim()) continue;
    results.push(await addYoutube(projectId, url.trim()));
  }

  for (const entry of form.getAll("files")) {
    if (!(entry instanceof File)) continue;
    results.push(await addUpload(projectId, entry));
  }

  if (results.length === 0) {
    return NextResponse.json(
      { error: "لم تُرسل أي ملفات أو روابط" },
      { status: 400 },
    );
  }

  return NextResponse.json({ results }, { status: 201 });
}

async function addYoutube(projectId: string, url: string): Promise<Result> {
  if (!env().ENABLE_YOUTUBE) {
    return {
      filename: url,
      ok: false,
      error:
        "دعم روابط يوتيوب معطّل. فعّله بـ ENABLE_YOUTUBE=true بعد قراءة التحذير في docs/PLAN.md.",
    };
  }

  if (!/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(url)) {
    return { filename: url, ok: false, error: "هذا ليس رابط يوتيوب صالحًا." };
  }

  const [item] = await db
    .insert(items)
    .values({
      projectId,
      title: url,
      sourceType: "youtube",
      sourceUrl: url,
      status: "queued",
      currentStage: "fetch",
    })
    .returning();

  if (!item) return { filename: url, ok: false, error: "تعذّر حفظ الرابط." };
  return { filename: url, ok: true, itemId: item.id, duplicate: false };
}

async function addUpload(projectId: string, file: File): Promise<Result> {
  const filename = file.name || "بدون اسم";

  if (file.size > MAX_UPLOAD_BYTES) {
    const limitMb = Math.round(MAX_UPLOAD_BYTES / 1024 / 1024);
    return {
      filename,
      ok: false,
      error: `الملف أكبر من الحدّ الحالي (${limitMb} ميغابايت).`,
    };
  }
  if (!isAcceptedMedia(file.type, filename)) {
    return { filename, ok: false, error: "نوع الملف غير مدعوم." };
  }

  const bytes = Buffer.from(await file.arrayBuffer());

  // نكتب الصف أولًا لنحصل على معرّف يُبنى عليه مسار التخزين،
  // ثم نحدّثه بالمسار والبصمة بعد الكتابة على القرص.
  const [item] = await db
    .insert(items)
    .values({
      projectId,
      title: filename.replace(/\.[^.]+$/, ""),
      sourceType: "upload",
      status: "queued",
      currentStage: "prepare",
    })
    .returning();

  if (!item) return { filename, ok: false, error: "تعذّر حفظ المقطع." };

  try {
    const { path, hash } = await saveMedia(item.id, filename, bytes);

    // المكرر: نفس البصمة في نفس المجلد — نعلّمه ولا نفرّغه مرتين.
    const [existing] = await db
      .select({ id: items.id })
      .from(items)
      .where(and(eq(items.projectId, projectId), eq(items.contentHash, hash)))
      .limit(1);

    await db
      .update(items)
      .set({ mediaPath: path, contentHash: hash })
      .where(eq(items.id, item.id));

    await db.insert(auditLog).values({
      itemId: item.id,
      action: "upload",
      actor: "user",
      detail: { filename, bytes: bytes.length },
    });

    return {
      filename,
      ok: true,
      itemId: item.id,
      duplicate: Boolean(existing && existing.id !== item.id),
    };
  } catch (err) {
    await db
      .update(items)
      .set({
        status: "failed",
        errorMessage: err instanceof Error ? err.message : "فشل حفظ الملف",
      })
      .where(eq(items.id, item.id));
    return { filename, ok: false, error: "تعذّر حفظ الملف على الخادم." };
  }
}
