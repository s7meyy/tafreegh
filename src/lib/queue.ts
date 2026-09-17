import { Queue } from "bullmq";
import { env } from "./env";
import { getRedis } from "./redis";

/**
 * طابور لكل مرحلة، بحدّ تزامن مستقل (§4.3).
 *
 * الفصل مقصود: التفريغ يحدّه المزوّد، والتحضير يحدّه المعالج. طابور
 * واحد يجعل الأبطأ يخنق الأسرع.
 */
export const STAGES = ["fetch", "prepare", "transcribe", "review", "audit", "cleanup"] as const;
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
    queue = new Queue(`tafreegh:${stage}`, {
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
  }
}

/** إدراج مقطع في أول الخط. الاسم يمنع ازدواج المهمة للمقطع نفسه. */
export async function enqueueFetch(itemId: string): Promise<void> {
  await queueFor("fetch").add("fetch", { itemId }, { jobId: `fetch:${itemId}` });
}

export async function enqueuePrepare(itemId: string): Promise<void> {
  await queueFor("prepare").add("prepare", { itemId }, { jobId: `prepare:${itemId}` });
}

export async function enqueueTranscribe(itemId: string): Promise<void> {
  await queueFor("transcribe").add(
    "transcribe",
    { itemId },
    { jobId: `transcribe:${itemId}` },
  );
}

export async function enqueueReview(itemId: string): Promise<void> {
  await queueFor("review").add("review", { itemId }, { jobId: `review:${itemId}` });
}

export async function enqueueCleanup(itemId: string): Promise<void> {
  await queueFor("cleanup").add(
    "cleanup",
    { itemId },
    // نمهل قليلًا: قد يكون المستخدم ما زال يستمع بعد ضغط «اعتماد».
    { jobId: `cleanup:${itemId}`, delay: 60_000 },
  );
}
