import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { appendFile, mkdir, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { env } from "./env";
import { getRedis } from "./redis";

/**
 * جلسة رفع مجزّأ مستأنف.
 *
 * `formData()` تحمّل الملف كاملًا في الذاكرة، فكانت تحدّ الرفع بـ‏200
 * ميغابايت. هنا تصل القطع تباعًا وتُلحق بالملف على القرص، فالذاكرة
 * تحمل قطعة واحدة مهما كبر الملف — والانقطاع لا يُفقد ما وصل.
 *
 * الحالة في Redis لا في الذاكرة: خادم الويب قد يُعاد تشغيله في منتصف
 * رفع طويل، والجلسة يجب أن تنجو.
 */

export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;
/** حجم القطعة الذي يرسله العميل. توازن بين عدد الطلبات وكلفة الإعادة. */
export const CHUNK_BYTES = 8 * 1024 * 1024;
/** سقف ما يقبله الخادم في الطلب الواحد — ضِعف الحجم المعتاد هامشًا. */
export const MAX_CHUNK_BYTES = 2 * CHUNK_BYTES;
/** الجلسة المهجورة تُنسى بعدها، وملفها الجزئي يُكنس. */
const TTL_SEC = 24 * 3600;

export interface UploadSession {
  id: string;
  /** صاحب الجلسة — يُتحقّق منه في كل قطعة، لا عند الفتح وحده */
  userId: string;
  projectId: string;
  filename: string;
  size: number;
  received: number;
  createdAt: number;
}

function key(id: string): string {
  return `upload:${id}`;
}

function partialPath(id: string): string {
  const root = resolve(env().STORAGE_DIR);
  const path = resolve(join(root, "uploads", `${id}.part`));
  if (!path.startsWith(root)) throw new Error("مسار رفع غير صالح");
  return path;
}

export async function createSession(
  userId: string,
  projectId: string,
  filename: string,
  size: number,
): Promise<UploadSession> {
  const session: UploadSession = {
    id: randomUUID(),
    userId,
    projectId,
    filename,
    size,
    received: 0,
    createdAt: Date.now(),
  };

  await mkdir(join(resolve(env().STORAGE_DIR), "uploads"), { recursive: true });
  await getRedis().setex(key(session.id), TTL_SEC, JSON.stringify(session));
  return session;
}

export async function getSession(id: string): Promise<UploadSession | null> {
  const raw = await getRedis().get(key(id));
  if (!raw) return null;

  const session = JSON.parse(raw) as UploadSession;

  // الحقيقة على القرص لا في Redis: لو سقط الخادم بعد الكتابة وقبل
  // تحديث العدّاد، لأعاد العميل إرسال قطعة موجودة فيتضاعف الملف.
  const actual = await stat(partialPath(id))
    .then((s) => s.size)
    .catch(() => 0);

  if (actual !== session.received) {
    session.received = actual;
    await getRedis().setex(key(id), TTL_SEC, JSON.stringify(session));
  }

  return session;
}

export type AppendResult =
  | { ok: true; received: number; complete: boolean }
  | { ok: false; error: string; received: number };

export async function appendChunk(
  session: UploadSession,
  offset: number,
  chunk: Buffer,
): Promise<AppendResult> {
  // القطعة التي سبق استلامها تُبتلع بلا خطأ: العميل يعيد الإرسال بعد
  // انقطاع، وردّ الخطأ عليه يوقف رفعًا سليمًا.
  if (offset + chunk.length <= session.received) {
    return { ok: true, received: session.received, complete: session.received >= session.size };
  }
  if (offset !== session.received) {
    return {
      ok: false,
      error: `القطعة خارج الترتيب؛ المستلَم ${session.received} بايت`,
      received: session.received,
    };
  }
  if (session.received + chunk.length > session.size) {
    return { ok: false, error: "القطعة تتجاوز الحجم المعلن", received: session.received };
  }

  await appendFile(partialPath(session.id), chunk);

  const received = session.received + chunk.length;
  await getRedis().setex(
    key(session.id),
    TTL_SEC,
    JSON.stringify({ ...session, received }),
  );

  return { ok: true, received, complete: received >= session.size };
}

/** بصمة الملف المكتمل — تُحسب بالبثّ فلا تُحمَّل الذاكرة. */
export async function finishSession(
  session: UploadSession,
): Promise<{ path: string; hash: string }> {
  const path = partialPath(session.id);

  const hash = await new Promise<string>((resolvePromise, reject) => {
    const sha = createHash("sha256");
    createReadStream(path)
      .on("data", (chunk) => sha.update(chunk))
      .on("end", () => resolvePromise(sha.digest("hex")))
      .on("error", reject);
  });

  await getRedis().del(key(session.id));
  return { path, hash };
}

export async function discardSession(id: string): Promise<void> {
  await getRedis().del(key(id));
  await rm(partialPath(id), { force: true });
}
