import { and, eq, isNotNull, isNull, lt, or } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, items, segments } from "@/db/schema";
import { env } from "@/lib/env";
import { deleteItemMedia } from "@/lib/storage";

/**
 * حذف الوسائط.
 *
 * هذا ما طُلب صراحةً: بعد الاعتماد لا يحتفظ الموقع بالصوت ولا الفيديو،
 * إنما بالنصّ وتوقيتاته. الوسائط ثقيلة والنصّ خفيف، فالتخزين يبقى
 * صغيرًا مهما كثرت المقاطع.
 *
 * التوقيتات لا تُحذف: هي مخزّنة في `transcripts.wordsJson` لا في ملف
 * الصوت، فيبقى تصدير srt/vtt ممكنًا بعد حذف الوسائط.
 */
export async function cleanupItem(itemId: string): Promise<void> {
  const [item] = await db.select().from(items).where(eq(items.id, itemId)).limit(1);
  if (!item) return; // حُذف المقطع نفسه — لا شيء يُنظَّف
  if (item.mediaDeletedAt) return; // نُظِّف سلفًا

  await deleteItemMedia(itemId);

  // خطة التقطيع لا معنى لها بلا وسائط، ومساراتها صارت ميتة.
  await db.delete(segments).where(eq(segments.itemId, itemId));

  await db
    .update(items)
    .set({ mediaPath: null, mediaDeletedAt: new Date() })
    .where(eq(items.id, itemId));

  await db.insert(auditLog).values({
    itemId,
    action: "media_deleted",
    actor: "worker",
    detail: { reason: item.approvedAt ? "approved" : "ttl" },
  });
}

/**
 * الكنّاس الدوري.
 *
 * المقاطع المهجورة — رُفعت ونُسيت بلا اعتماد — هي السبب الأول لامتلاء
 * القرص في موقع كهذا. فتُحذف وسائطها بعد `MEDIA_TTL_DAYS` ويبقى نصّها.
 */
export async function sweepExpiredMedia(): Promise<number> {
  const cutoff = new Date(Date.now() - env().MEDIA_TTL_DAYS * 86_400_000);

  const expired = await db
    .select({ id: items.id })
    .from(items)
    .where(
      and(
        isNull(items.mediaDeletedAt),
        isNotNull(items.mediaPath),
        lt(items.createdAt, cutoff),
        // المقطع الذي يعمل عليه العامل الآن لا يُمسّ.
        or(eq(items.status, "awaiting_approval"), eq(items.status, "failed")),
      ),
    );

  for (const row of expired) {
    await cleanupItem(row.id).catch((err) => {
      console.error(`[cleanup] تعذّر تنظيف ${row.id}:`, err);
    });
  }

  return expired.length;
}
