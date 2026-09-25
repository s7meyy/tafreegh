import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { auditLog, items, segments, transcripts } from "@/db/schema";
import { unauthorized } from "@/lib/api";
import { loadItem } from "@/lib/items";
import { enqueue } from "@/lib/queue";
import { resumeStage } from "@/lib/retry";
import { requireApiUser } from "@/lib/session";
import { deleteItemMedia } from "@/lib/storage";

const patchSchema = z.object({
  title: z.string().trim().min(1, "العنوان مطلوب").max(200).optional(),
  /** إعادة معالجة مقطع فاشل من أول مرحلة لم يكتمل ناتجها */
  retry: z.literal(true).optional(),
});

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const user = await requireApiUser();
  if (!user) return unauthorized();

  const loaded = await loadItem(id, user.id);
  if (!loaded) return NextResponse.json({ error: "المقطع غير موجود" }, { status: 404 });

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" },
      { status: 400 },
    );
  }

  if (parsed.data.title) {
    await db.update(items).set({ title: parsed.data.title }).where(eq(items.id, id));
  }

  if (parsed.data.retry) {
    const { item } = loaded;
    if (item.status !== "failed") {
      return NextResponse.json(
        { error: "إعادة المحاولة للمقاطع الفاشلة وحدها." },
        { status: 409 },
      );
    }

    const [segment] = await db
      .select({ id: segments.id })
      .from(segments)
      .where(eq(segments.itemId, id))
      .limit(1);
    const [merged] = await db
      .select({ id: transcripts.id })
      .from(transcripts)
      .where(
        and(
          eq(transcripts.itemId, id),
          eq(transcripts.stage, "transcribe"),
          isNull(transcripts.segmentId),
        ),
      )
      .limit(1);

    const decision = resumeStage({
      sourceType: item.sourceType,
      hasMedia: Boolean(item.mediaPath),
      mediaDeleted: Boolean(item.mediaDeletedAt),
      hasSegments: Boolean(segment),
      hasTranscript: Boolean(merged),
    });

    if (!decision.ok) {
      return NextResponse.json({ error: decision.reason }, { status: 409 });
    }

    await db
      .update(items)
      .set({ status: "queued", currentStage: decision.stage, errorMessage: null })
      .where(eq(items.id, id));

    await db.insert(auditLog).values({
      itemId: id,
      action: "retry",
      actor: "user",
      detail: { from: decision.stage },
    });

    await enqueue(decision.stage, id);
    return NextResponse.json({ ok: true, stage: decision.stage });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;
  const user = await requireApiUser();
  if (!user) return unauthorized();

  const loaded = await loadItem(id, user.id);
  if (!loaded) return NextResponse.json({ error: "المقطع غير موجود" }, { status: 404 });

  // الوسائط قبل الصفّ، وإلا بقي ملف يتيم لا صفّ يدلّ عليه.
  await deleteItemMedia(id);
  await db.delete(items).where(eq(items.id, id));

  return NextResponse.json({ ok: true, projectId: loaded.project.id });
}
