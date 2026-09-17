import { execFile } from "node:child_process";
import { mkdir, readdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, items } from "@/db/schema";
import { env } from "@/lib/env";
import { enqueuePrepare } from "@/lib/queue";
import { itemMediaDir } from "@/lib/storage";

const run = promisify(execFile);

/** ساعة لكل تنزيل. العملية المعلّقة تُجمّد عاملًا إلى الأبد. */
const TIMEOUT_MS = 60 * 60_000;
/** أطول مقطع نقبله — ثلاث ساعات. أطول من ذلك غالبًا بثّ حيّ أو خطأ. */
const MAX_DURATION_SEC = 3 * 3600;

/**
 * جلب الصوت من رابط.
 *
 * خلف `ENABLE_YOUTUBE` لأن التنزيل قد يخالف شروط خدمة يوتيوب وقد
 * يُحجب الخادم (§5 من الخطة). الرفع المباشر هو المسار الموصى به.
 */
export async function fetchItem(itemId: string): Promise<void> {
  const [item] = await db.select().from(items).where(eq(items.id, itemId)).limit(1);
  if (!item) throw new Error(`المقطع ${itemId} غير موجود`);

  if (!env().ENABLE_YOUTUBE) {
    throw new Error("جلب الروابط معطّل. فعّله بـ ENABLE_YOUTUBE=true.");
  }
  if (!item.sourceUrl) throw new Error("لا رابط لهذا المقطع.");

  await db
    .update(items)
    .set({ status: "fetching", currentStage: "fetch", errorMessage: null })
    .where(eq(items.id, itemId));

  const dir = itemMediaDir(itemId);
  await mkdir(dir, { recursive: true });

  const info = await probeUrl(item.sourceUrl);
  if (info.duration && info.duration > MAX_DURATION_SEC) {
    throw new Error(
      `المقطع أطول من ${MAX_DURATION_SEC / 3600} ساعات؛ نزّله ثم ارفعه مباشرة.`,
    );
  }

  await download(item.sourceUrl, dir);

  // yt-dlp يختار الامتداد بحسب أفضل صيغة متاحة، فنبحث عمّا كتبه.
  const written = (await readdir(dir)).find((f) => f.startsWith("download."));
  if (!written) throw new Error("انتهى التنزيل دون أن يُكتب ملف.");

  const mediaPath = join(dir, `source${extensionOf(written)}`);
  await rename(join(dir, written), mediaPath);

  await db
    .update(items)
    .set({
      mediaPath,
      title: info.title || item.title,
      durationSec: info.duration ?? null,
      status: "queued",
      currentStage: "prepare",
    })
    .where(eq(items.id, itemId));

  await db.insert(auditLog).values({
    itemId,
    action: "fetch",
    actor: "worker",
    detail: { url: item.sourceUrl, title: info.title, duration: info.duration },
  });

  await enqueuePrepare(itemId);
}

interface UrlInfo {
  title: string;
  duration: number | null;
}

/** فحص قبل التنزيل: المدة والعنوان، بلا تحميل بايت واحد من الصوت. */
async function probeUrl(url: string): Promise<UrlInfo> {
  try {
    const { stdout } = await run(
      "yt-dlp",
      [
        "--no-playlist",
        "--skip-download",
        "--print",
        "%(title)s\n%(duration)s",
        // `--` يمنع تفسير أي رابط على أنه راية، دفاعًا في العمق فوق
        // التحقق من صيغة الرابط عند الإدخال.
        "--",
        url,
      ],
      { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 },
    );

    const [title = "", duration = ""] = stdout.trim().split("\n");
    const seconds = Number(duration);
    return {
      title: title.trim(),
      duration: Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : null,
    };
  } catch (err) {
    throw new Error(describe(err));
  }
}

async function download(url: string, dir: string): Promise<void> {
  try {
    await run(
      "yt-dlp",
      [
        "--no-playlist",
        // صوت فقط: الفيديو يُهدر نطاقًا وقرصًا ولا يُستعمل.
        "-f",
        "bestaudio/best",
        "--extract-audio",
        "--audio-format",
        "m4a",
        "--no-progress",
        "-o",
        join(dir, "download.%(ext)s"),
        "--",
        url,
      ],
      { timeout: TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 },
    );
  } catch (err) {
    throw new Error(describe(err));
  }
}

/** رسائل yt-dlp إنجليزية ومطوّلة؛ نترجم أشيعها إلى ما يفيد المستخدم. */
function describe(err: unknown): string {
  if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
    return "yt-dlp غير مثبّت على الخادم. ثبّته ثم أعد المحاولة.";
  }

  const stderr =
    err && typeof err === "object" && "stderr" in err ? String(err.stderr) : "";

  if (/private video/i.test(stderr)) return "المقطع خاص ولا يمكن الوصول إليه.";
  if (/video unavailable/i.test(stderr)) return "المقطع غير متاح أو محذوف.";
  if (/sign in to confirm|bot/i.test(stderr)) {
    return "يوتيوب يطلب إثبات هوية من الخادم. نزّل المقطع بنفسك وارفعه مباشرة.";
  }
  if (/copyright|blocked/i.test(stderr)) return "المقطع محجوب في منطقة الخادم.";

  const tail = stderr.trim().split("\n").slice(-3).join(" ");
  return `تعذّر جلب الرابط: ${tail || (err instanceof Error ? err.message : "خطأ غير معروف")}`;
}

function extensionOf(filename: string): string {
  return filename.match(/\.[a-z0-9]+$/i)?.[0]?.toLowerCase() ?? ".m4a";
}
