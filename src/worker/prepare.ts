import { mkdir, readdir } from "node:fs/promises";
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

  /**
   * المصدر هو `source.*` في مجلد المقطع، لا `mediaPath`.
   *
   * بعد نجاح التحضير يشير `mediaPath` إلى `normalized.wav`. فلو أُعيدت
   * المهمة (انقطاع، أو فشل مرحلة لاحقة) لحاول ffmpeg تطبيع الملف
   * المطبَّع فوق نفسه وأبى: «cannot edit existing files in-place».
   * التحضير يجب أن يُعاد بأمان مهما كانت حالة المقطع.
   */
  const dir = dirname(item.mediaPath);
  const sourcePath = await findSource(dir, item.mediaPath);
  const info = await probe(sourcePath);

  const wavPath = join(dir, "normalized.wav");
  await mkdir(dir, { recursive: true });
  await normalizeToWav(sourcePath, wavPath);

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

/** الملف الأصلي في مجلد المقطع؛ وإن لم يوجد فالمسار المسجّل كما هو. */
async function findSource(dir: string, fallback: string): Promise<string> {
  const entries = await readdir(dir).catch(() => [] as string[]);
  const source = entries.find((f) => f.startsWith("source."));
  return source ? join(dir, source) : fallback;
}
