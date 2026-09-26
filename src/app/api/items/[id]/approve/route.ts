import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { auditLog, items, transcripts } from "@/db/schema";
import { tidyOutput, wordErrorRate } from "@/lib/arabic";
import { bestText, loadItem } from "@/lib/items";
import { stripSpeakers } from "@/lib/transcript/speakers";
import { enqueueCleanup } from "@/lib/queue";
import { unauthorized } from "@/lib/api";
import { requireApiUser } from "@/lib/session";

const schema = z.object({
  /** نصّ المستخدم بعد تحريره؛ إن غاب اعتُمد نصّ التدقيق كما هو */
  text: z.string().trim().min(1).optional(),
});

/**
 * الاعتماد.
 *
 * يجمّد النصّ ويفعّل التصدير ويجدول حذف الوسائط. الحذف مهمة مؤجّلة لا
 * فعل فوري: المستخدم قد يكون ما زال يستمع، ولو فشل الحذف لسبب عابر
 * أُعيدت المحاولة بدل أن يُفشل الاعتماد نفسه.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const user = await requireApiUser();
  if (!user) return unauthorized();

  const loaded = await loadItem(id, user.id);
  if (!loaded) {
    return NextResponse.json({ error: "المقطع غير موجود" }, { status: 404 });
  }
  if (loaded.item.approvedAt) {
    return NextResponse.json({ error: "المقطع معتمد سلفًا" }, { status: 409 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "نصّ غير صالح" }, { status: 400 });
  }

  // كم غيّر المستخدم بعد المراجعتين: أصدق مقياس لجودة الخط على مقاطعه
  // هو، بلا نصّ مرجعي. صفر يعني أن الآلة أصابت كل شيء — أو أنه لم يراجع.
  const machine = bestText(loaded.stages);
  const userEditRate =
    parsed.data.text && machine
      ? wordErrorRate(stripSpeakers(machine), stripSpeakers(parsed.data.text))
      : 0;

  // نصّ المستخدم يُحفظ نسخةً مستقلة لا يُعدَّل فوق نصّ التدقيق:
  // المراحل كلها محفوظة ليمكن الرجوع والمقارنة دائمًا.
  if (parsed.data.text) {
    await db.insert(transcripts).values({
      itemId: id,
      stage: "export",
      engine: "user",
      model: "manual",
      text: tidyOutput(parsed.data.text),
    });
  }

  const approvedAt = new Date();
  await db
    .update(items)
    .set({ status: "approved", currentStage: "export", approvedAt })
    .where(eq(items.id, id));

  await db.insert(auditLog).values({
    itemId: id,
    action: "approve",
    actor: "user",
    detail: { edited: Boolean(parsed.data.text), userEditRate },
  });

  await enqueueCleanup(id);

  return NextResponse.json({ ok: true, approvedAt });
}
