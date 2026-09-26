import { DelayedError, UnrecoverableError, Worker, type Job } from "bullmq";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { items } from "@/db/schema";
import { ConfigError, QuotaExhaustedError } from "@/lib/errors";
import { concurrencyFor, type Stage } from "@/lib/queue";
import { getRedis } from "@/lib/redis";
import { cleanupItem, sweepExpiredMedia } from "./cleanup";
import { setEnrichment } from "@/lib/enrich/store";
import { enrichItem } from "./enrich";
import type { EnrichKind, Enrichment } from "@/lib/enrich/types";
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
    `tafreegh-${stage}`,
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

        // خطأ الإعداد لا يُصلحه التكرار: يُسجَّل فورًا، و UnrecoverableError
        // تمنع BullMQ من محاولتين أخريين بلا فائدة.
        if (err instanceof ConfigError) {
          await recordFailure(itemId, stage, job, err, true);
          throw new UnrecoverableError(err.message);
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
  final = false,
): Promise<void> {
  // attemptsMade لا يشمل المحاولة الجارية بعد
  const attemptsLeft = (job.opts.attempts ?? 1) - (job.attemptsMade + 1);
  if (!final && attemptsLeft > 0) return;

  await db
    .update(items)
    .set({
      status: "failed",
      // الإضافات لا تمرّ بهذا المسار؛ حالتها في `enrichment`
      currentStage: stage as Exclude<Stage, "enrich">,
      errorMessage: err instanceof Error ? err.message : "خطأ غير متوقع",
    })
    .where(eq(items.id, itemId));
}

/**
 * عامل الإضافات: الحصة كما في غيره (تأجيل لا فشل)، لكن الفشل يُسجَّل
 * في حالة الإضافة لا في حالة المقطع — المقطع سليم وإن تعذّر ملخصه.
 */
function startEnrichWorker() {
  const worker = new Worker(
    "tafreegh-enrich",
    async (job: Job<{ itemId: string; kind: EnrichKind }>, token?: string) => {
      const { itemId, kind } = job.data;
      try {
        await enrichItem(itemId, kind);
      } catch (err) {
        if (err instanceof QuotaExhaustedError && token) {
          console.log(`[enrich] تأجيل ${kind} ${itemId}: ${err.message}`);
          await job.moveToDelayed(Date.now() + err.retryAfterMs, token);
          throw new DelayedError();
        }
        const attemptsLeft = (job.opts.attempts ?? 1) - (job.attemptsMade + 1);
        if (err instanceof ConfigError || attemptsLeft <= 0) {
          // يُبقى ما أُنجز (فقرات التشكيل المحفوظة) ليُستأنف منه عند الإعادة
          const [row] = await db.select({ e: items.enrichment }).from(items).where(eq(items.id, itemId));
          const current = ((row?.e ?? {}) as Enrichment)[kind];
          await setEnrichment(itemId, kind, {
            mode: "full",
            ...current,
            status: "failed",
            error: err instanceof Error ? err.message : "خطأ غير متوقع",
          });
          if (err instanceof ConfigError) throw new UnrecoverableError(err.message);
        }
        throw err;
      }
    },
    { connection: getRedis(), concurrency: concurrencyFor("enrich") },
  );
  worker.on("failed", (job, err) => {
    if (err instanceof DelayedError) return;
    console.error(`[enrich] فشلت المهمة ${job?.id}:`, err.message);
  });
  worker.on("completed", (job) => console.log(`[enrich] اكتملت ${job.id}`));
  return worker;
}

const workers = [
  ...Object.entries(handlers).map(([stage, handle]) => startWorker(stage as Stage, handle)),
  startEnrichWorker(),
];

console.log(`عامل تفريغ يعمل — المراحل: ${[...Object.keys(handlers), "enrich"].join("، ")}`);

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
