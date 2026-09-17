import { mkdir, rename, rm, unlink } from "node:fs/promises";
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

/**
 * نقل ملف رفع مكتمل إلى مجلد مقطعه.
 *
 * ضروري لا تنظيمي: `deleteItemMedia` تحذف مجلد المقطع، فملفٌ باقٍ في
 * `uploads/` لا يُحذف أبدًا — ويبقى غيغابايت على القرص بعد الاعتماد.
 * وكل ما تنتجه المراحل لاحقًا (النسخة المطبّعة، المقاطع الفرعية) يُكتب
 * بجوار هذا الملف، فيُحذف معه.
 */
export async function adoptUpload(
  itemId: string,
  tempPath: string,
  filename: string,
): Promise<string> {
  const dir = itemDir(itemId);
  await mkdir(dir, { recursive: true });

  const ext = filename.match(/\.[a-z0-9]+$/i)?.[0]?.toLowerCase() ?? "";
  const path = join(dir, `source${ext}`);
  await rename(tempPath, path);
  return path;
}

export async function deleteMedia(path: string): Promise<void> {
  await unlink(path).catch((err: NodeJS.ErrnoException) => {
    // الملف محذوف سلفًا — هذا نجاح لا فشل.
    if (err.code !== "ENOENT") throw err;
  });
}

/**
 * حذف كل وسائط مقطع: الأصل، والنسخة المطبّعة، وأي مقاطع فرعية بقيت.
 * يُنادى بعد الاعتماد وبعد انقضاء مدة الاحتفاظ (§5 المرحلة 5).
 */
export async function deleteItemMedia(itemId: string): Promise<void> {
  await rm(itemDir(itemId), { recursive: true, force: true });
}
