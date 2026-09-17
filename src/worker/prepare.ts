import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, items, segments } from "@/db/schema";
import {
  detectSilence,
  normalizeToWav,
  probe,
} from "@/lib/media/ffmpeg";
import { planSegments } from "@/lib/media/plan";
import { enqueueTranscribe } from "@/lib/queue";

/**
 * مرحلة التحضير: فحص الملف، تطبيعه إلى WAV ‏16kHz أحادي، كشف الصمت،
 * وبناء خطة التقطيع وحفظها.
 *
 * لا تستخرج المقاطع الفرعية إلى ملفات هنا: تُستخرج عند التفريغ وتُحذف
 * فور قراءتها، فلا يتضخّم القرص بنسخ مؤقتة لمقاطع تنتظر حصة.
 */
export async function prepareItem(itemId: string): Promise<void> {
  const [item] = await db.select().from(items).where(eq(items.id, itemId)).limit(1);
  if (!item) throw new Error(`المقطع ${itemId} غير موجود`);

  if (!item.mediaPath) {
    throw new Error("لا ملف وسائط لهذا المقطع — ربما حُذف أو فشل رفعه.");
  }

  await db
    .update(items)
    .set({ status: "preparing", currentStage: "prepare", errorMessage: null })
    .where(eq(items.id, itemId));

  const info = await probe(item.mediaPath);

  const wavPath = join(dirname(item.mediaPath), "normalized.wav");
  await mkdir(dirname(wavPath), { recursive: true });
  await normalizeToWav(item.mediaPath, wavPath);

  const silences = await detectSilence(wavPath);
  const plans = planSegments(Math.round(info.durationSec * 1000), silences);

  // التحضير قد يُعاد بعد انقطاع؛ نمسح خطة سابقة حتى لا تتراكم.
  await db.delete(segments).where(eq(segments.itemId, itemId));
  if (plans.length > 0) {
    await db.insert(segments).values(
      plans.map((p) => ({
        itemId,
        index: p.index,
        startMs: p.startMs,
        endMs: p.endMs,
        overlapMs: p.overlapMs,
      })),
    );
  }

  await db
    .update(items)
    .set({
      durationSec: Math.round(info.durationSec),
      mediaPath: wavPath,
      status: "transcribing",
      currentStage: "transcribe",
    })
    .where(eq(items.id, itemId));

  await db.insert(auditLog).values({
    itemId,
    action: "prepare",
    actor: "worker",
    detail: {
      durationSec: Math.round(info.durationSec),
      segments: plans.length,
      silences: silences.length,
    },
  });

  await enqueueTranscribe(itemId);
}
