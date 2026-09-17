import { DelayedError, Worker, type Job } from "bullmq";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { items } from "@/db/schema";
import { QuotaExhaustedError } from "@/lib/errors";
import { concurrencyFor, type Stage } from "@/lib/queue";
import { getRedis } from "@/lib/redis";
import { cleanupItem, sweepExpiredMedia } from "./cleanup";
import { fetchItem } from "./fetch";
import { prepareItem } from "./prepare";
import { reviewItem } from "./review";
import { transcribeItem } from "./transcribe";

/**
 * العامل — عملية مستقلة عن خادم الويب.
 *
 * فصلها مقصود: مهمة التفريغ تستغرق دقائق، وطلب HTTP لا يجب أن ينتظرها.
 * التشغيل: `npm run worker`.
 */

const handlers: Partial<Record<Stage, (itemId: string) => Promise<void>>> = {
  fetch: fetchItem,
  prepare: prepareItem,
  transcribe: transcribeItem,
  review: reviewItem,
  cleanup: cleanupItem,
};

/** كنس الوسائط المهجورة — كل ساعة، ومرة عند الإقلاع. */
const SWEEP_INTERVAL_MS = 3_600_000;

async function sweep() {
  try {
    const count = await sweepExpiredMedia();
    if (count > 0) console.log(`[cleanup] حُذفت وسائط ${count} مقطعًا منتهي المدة`);
  } catch (err) {
    console.error("[cleanup] فشل الكنس الدوري:", err);
  }
}

function startWorker(stage: Stage, handle: (itemId: string) => Promise<void>) {
  const worker = new Worker(
    `tafreegh:${stage}`,
    async (job: Job<{ itemId: string }>, token?: string) => {
      const { itemId } = job.data;
      try {
        await handle(itemId);
      } catch (err) {
        /**
         * نفاد الحصة ليس فشلًا، بل انتظار. فالمهمة تُؤجَّل إلى حين
         * تجدّد النافذة **دون احتساب محاولة**: لو عُدّت فشلًا لاستهلك
         * مقطعٌ طويلٌ محاولاته الثلاث في يوم واحد ثم مات.
         *
         * `DelayedError` هي الطريقة التي يفهم بها BullMQ أن المهمة
         * انتقلت إلى التأجيل ولم تفشل.
         */
        if (err instanceof QuotaExhaustedError && token) {
          console.log(`[${stage}] تأجيل ${itemId}: ${err.message}`);
          await job.moveToDelayed(Date.now() + err.retryAfterMs, token);
          throw new DelayedError();
        }

        await recordFailure(itemId, stage, job, err);
        throw err;
      }
    },
    { connection: getRedis(), concurrency: concurrencyFor(stage) },
  );

  worker.on("failed", (job, err) => {
    if (err instanceof DelayedError) return;
    console.error(`[${stage}] فشلت المهمة ${job?.id}:`, err.message);
  });
  worker.on("completed", (job) => console.log(`[${stage}] اكتملت ${job.id}`));

  return worker;
}

/**
 * الفشل يُسجَّل برسالة عربية للمستخدم بعد استنفاد المحاولات فقط —
 * قبلها المهمة ما زالت حيّة، وإظهارها فاشلةً يُقلق بلا سبب.
 */
async function recordFailure(
  itemId: string,
  stage: Stage,
  job: Job,
  err: unknown,
): Promise<void> {
  const attemptsLeft = (job.opts.attempts ?? 1) - job.attemptsMade;
  if (attemptsLeft > 0) return;

  await db
    .update(items)
    .set({
      status: "failed",
      currentStage: stage,
      errorMessage: err instanceof Error ? err.message : "خطأ غير متوقع",
    })
    .where(eq(items.id, itemId));
}

const workers = Object.entries(handlers).map(([stage, handle]) =>
  startWorker(stage as Stage, handle),
);

console.log(`عامل تفريغ يعمل — المراحل: ${Object.keys(handlers).join("، ")}`);

void sweep();
const sweepTimer = setInterval(() => void sweep(), SWEEP_INTERVAL_MS);

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, async () => {
    console.log("إيقاف العامل…");
    clearInterval(sweepTimer);
    // الإغلاق اللطيف ينتظر المهام الجارية، فلا تُقطع مهمة في منتصفها.
    await Promise.all(workers.map((w) => w.close()));
    process.exit(0);
  });
}
