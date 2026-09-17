import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { items, projects } from "@/db/schema";
import { env } from "@/lib/env";
import { getCurrentUser } from "@/lib/session";

type Result =
  | { filename: string; ok: true; itemId: string }
  | { filename: string; ok: false; error: string };

/**
 * إضافة مقاطع من روابط.
 *
 * رفع الملفات لا يمرّ من هنا: له مسار مجزّأ مستأنف على `/api/uploads`،
 * لأن `formData()` تحمّل الملف كاملًا في الذاكرة فتحدّ الحجم.
 */
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

  if (results.length === 0) {
    return NextResponse.json({ error: "لم تُرسل أي روابط" }, { status: 400 });
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
  return { filename: url, ok: true, itemId: item.id };
}
