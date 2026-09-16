import { createHash } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { env } from "./env";

/** أنواع الوسائط المقبولة. الفحص بالمحتوى يأتي في م1 مع ffprobe. */
const ACCEPTED = new Set([
  "audio/mpeg",
  "audio/mp4",
  "audio/x-m4a",
  "audio/wav",
  "audio/x-wav",
  "audio/webm",
  "audio/ogg",
  "audio/flac",
  "audio/aac",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/x-matroska",
]);

/**
 * حدّ الرفع في م0. الرفع المجزّأ المستأنف مجدول في م5 (§9)،
 * وعندها يرتفع الحدّ إلى 2GB.
 */
export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

export function isAcceptedMedia(type: string, filename: string): boolean {
  if (ACCEPTED.has(type)) return true;
  // بعض المتصفحات ترسل نوعًا فارغًا؛ نقبل بالامتداد ثم يتحقّق ffprobe لاحقًا.
  return /\.(mp3|m4a|wav|webm|ogg|flac|aac|mp4|mov|mkv)$/i.test(filename);
}

/** مجلد الوسائط لمقطع واحد، داخل STORAGE_DIR. */
function itemDir(itemId: string): string {
  const root = resolve(env().STORAGE_DIR);
  const dir = resolve(join(root, "items", itemId));
  // حارس ضد اجتياز المسار لو تسرّب معرّف غير صالح.
  if (!dir.startsWith(root)) throw new Error("مسار تخزين غير صالح");
  return dir;
}

export async function saveMedia(
  itemId: string,
  filename: string,
  bytes: Buffer,
): Promise<{ path: string; hash: string }> {
  const dir = itemDir(itemId);
  await mkdir(dir, { recursive: true });

  const ext = filename.match(/\.[a-z0-9]+$/i)?.[0]?.toLowerCase() ?? "";
  const path = join(dir, `source${ext}`);
  await writeFile(path, bytes);

  const hash = createHash("sha256").update(bytes).digest("hex");
  return { path, hash };
}

export async function deleteMedia(path: string): Promise<void> {
  await unlink(path).catch((err: NodeJS.ErrnoException) => {
    // الملف محذوف سلفًا — هذا نجاح لا فشل.
    if (err.code !== "ENOENT") throw err;
  });
}
