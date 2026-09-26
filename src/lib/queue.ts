import { Queue } from "bullmq";
import { env } from "./env";
import { getRedis } from "./redis";

/**
 * طابور لكل مرحلة، بحدّ تزامن مستقل (§4.3).
 *
 * الفصل مقصود: التفريغ يحدّه المزوّد، والتحضير يحدّه المعالج. طابور
 * واحد يجعل الأبطأ يخنق الأسرع.
 */
export const STAGES = ["fetch", "prepare", "transcribe", "review", "audit", "cleanup", "enrich"] as const;
export type Stage = (typeof STAGES)[number];

export interface PrepareJob {
  itemId: string;
}
export interface TranscribeJob {
  itemId: string;
}

export type JobData = { prepare: PrepareJob; transcribe: TranscribeJob };

const queues = new Map<Stage, Queue>();

export function queueFor(stage: Stage): Queue {
  let queue = queues.get(stage);
  if (!queue) {
    queue = new Queue(`tafreegh-${stage}`, {
      connection: getRedis(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: { age: 86_400, count: 500 },
        removeOnFail: { age: 7 * 86_400 },
      },
    });
    queues.set(stage, queue);
  }
  return queue;
}

export function concurrencyFor(stage: Stage): number {
  const e = env();
  switch (stage) {
    case "fetch":
      // التنزيل يحدّه النطاق لا المعالج، وتوازٍ كثيف يستدعي حجب الخادم.
      return 2;
    case "prepare":
      return e.CONCURRENCY_PREPARE;
    case "transcribe":
      return e.CONCURRENCY_TRANSCRIBE;
    case "review":
      return e.CONCURRENCY_REVIEW;
    case "audit":
      return e.CONCURRENCY_AUDIT;
    case "cleanup":
      return 1;
    case "enrich":
      // إضافات لا يستعجلها أحد: واحدة في كل مرة، فلا تزاحم التفريغ على الحصة
      return 1;
  }
}

/**
 * إدراج مقطع في مرحلة.
 *
 * معرّف المهمة ثابت (`مرحلة-مقطع`) ليمنع ازدواج المهمة للمقطع نفسه.
 * لكن BullMQ يحتفظ بالمهمة الفاشلة أيامًا، ويرفض بصمتٍ إضافة مهمة
 * بمعرّف موجود — فكانت إعادة المحاولة بعد فشل تُبتلع بلا أثر، ويبقى
 * المقطع عالقًا حتى تُكنس المهمة القديمة. لذلك تُزال المهمة المنتهية
 * (فاشلة أو مكتملة) قبل الإضافة؛ أما الجارية أو المنتظرة فتبقى، وهذا
 * هو منع الازدواج المقصود.
 *
 * ملاحظة: `:` ممنوع في أسماء الطوابير ومعرّفات المهام معًا.
 */
export async function enqueue(
  stage: Stage,
  itemId: string,
  options: { delay?: number } = {},
): Promise<void> {
  const queue = queueFor(stage);
  const jobId = `${stage}-${itemId}`;

  const existing = await queue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (state === "failed" || state === "completed") {
      await existing.remove();
    } else {
      return; // منتظرة أو جارية أو مؤجّلة — لا نضاعفها
    }
  }

  await queue.add(stage, { itemId }, { jobId, ...options });
}

export const enqueueFetch = (itemId: string) => enqueue("fetch", itemId);
export const enqueuePrepare = (itemId: string) => enqueue("prepare", itemId);
export const enqueueTranscribe = (itemId: string) => enqueue("transcribe", itemId);
export const enqueueReview = (itemId: string) => enqueue("review", itemId);
/** نمهل قليلًا: قد يكون المستخدم ما زال يستمع بعد ضغط «اعتماد». */
export const enqueueCleanup = (itemId: string) =>
  enqueue("cleanup", itemId, { delay: 60_000 });

/**
 * الملخص أو التشكيل لمقطع. معرّف لكلٍّ منهما، فيجريان معًا، ولا يتكرّر
 * أحدهما وهو قيد التنفيذ.
 */
export async function enqueueEnrich(itemId: string, kind: "summary" | "tashkeel"): Promise<void> {
  const queue = queueFor("enrich");
  const jobId = `enrich-${kind}-${itemId}`;
  const existing = await queue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (state !== "failed" && state !== "completed") return;
    await existing.remove();
  }
  await queue.add(kind, { itemId, kind }, { jobId });
}
