import { Worker, type Job } from "bullmq";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { items } from "@/db/schema";
import { QuotaExhaustedError } from "@/lib/providers/registry";
import { concurrencyFor, type Stage } from "@/lib/queue";
import { getRedis } from "@/lib/redis";
import { prepareItem } from "./prepare";
import { transcribeItem } from "./transcribe";

/**
 * العامل — عملية مستقلة عن خادم الويب.
 *
 * فصلها مقصود: مهمة التفريغ تستغرق دقائق، وطلب HTTP لا يجب أن ينتظرها.
 * التشغيل: `npm run worker`.
 */

const handlers: Partial<Record<Stage, (itemId: string) => Promise<void>>> = {
  prepare: prepareItem,
  transcribe: transcribeItem,
};

function startWorker(stage: Stage, handle: (itemId: string) => Promise<void>) {
  const worker = new Worker(
    `tafreegh:${stage}`,
    async (job: Job<{ itemId: string }>) => {
      const { itemId } = job.data;
      try {
        await handle(itemId);
      } catch (err) {
        await onFailure(itemId, stage, job, err);
        throw err;
      }
    },
    { connection: getRedis(), concurrency: concurrencyFor(stage) },
  );

  worker.on("failed", (job, err) => {
    console.error(`[${stage}] فشلت المهمة ${job?.id}:`, err.message);
  });
  worker.on("completed", (job) => {
    console.log(`[${stage}] اكتملت ${job.id}`);
  });

  return worker;
}

/**
 * نفاد الحصة ليس فشلًا: المقطع يعود إلى الانتظار ويُعاد جدولته بعد
 * تجدّد النافذة. أما الفشل الحقيقي فيُسجَّل برسالة عربية للمستخدم،
 * وبعد استنفاد المحاولات فقط — قبلها المهمة ما زالت حيّة.
 */
async function onFailure(
  itemId: string,
  stage: Stage,
  job: Job,
  err: unknown,
): Promise<void> {
  if (err instanceof QuotaExhaustedError) {
    await db
      .update(items)
      .set({ status: "queued", errorMessage: err.message })
      .where(eq(items.id, itemId));
    await job.moveToDelayed(Date.now() + err.retryAfterMs).catch(() => {});
    return;
  }

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

console.log(
  `عامل تفريغ يعمل — المراحل: ${Object.keys(handlers).join("، ")}`,
);

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, async () => {
    console.log("إيقاف العامل…");
    // الإغلاق اللطيف ينتظر المهام الجارية، فلا تُقطع مهمة في منتصفها.
    await Promise.all(workers.map((w) => w.close()));
    process.exit(0);
  });
}
