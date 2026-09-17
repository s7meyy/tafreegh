import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { items, projects } from "@/db/schema";
import { getCurrentUser } from "@/lib/session";
import { deleteItemMedia } from "@/lib/storage";

const schema = z.object({
  itemIds: z.array(z.string().uuid()).min(1).max(500),
});

/**
 * حذف جماعي.
 *
 * الوسائط تُحذف قبل الصفوف: لو حُذف الصفّ أولًا وفشل حذف الملف، بقي
 * الملف على القرص بلا صفّ يدلّ عليه — ملف يتيم لا يعرف أحد أنه هناك.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  const user = await getCurrentUser();

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "بيانات غير صحيحة" }, { status: 400 });
  }

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
    .limit(1);

  if (!project) {
    return NextResponse.json({ error: "المجلد غير موجود" }, { status: 404 });
  }

  const owned = await db
    .select({ id: items.id })
    .from(items)
    .where(and(eq(items.projectId, projectId), inArray(items.id, parsed.data.itemIds)));

  if (owned.length === 0) {
    return NextResponse.json({ error: "لا مقاطع مطابقة" }, { status: 404 });
  }

  for (const row of owned) {
    await deleteItemMedia(row.id).catch((err) => {
      console.error(`[delete] تعذّر حذف وسائط ${row.id}:`, err);
    });
  }

  // بقية الجداول تُحذف بالتتابع عبر onDelete: cascade.
  await db.delete(items).where(
    inArray(
      items.id,
      owned.map((r) => r.id),
    ),
  );

  return NextResponse.json({ deleted: owned.length });
}
