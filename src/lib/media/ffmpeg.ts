import { execFile } from "node:child_process";
import { readFile, unlink } from "node:fs/promises";
import { promisify } from "node:util";
import type { SilenceGap } from "./plan";

const run = promisify(execFile);

/** حدّ زمني لكل استدعاء — عملية معلّقة تُجمّد عاملًا إلى الأبد. */
const TIMEOUT_MS = 30 * 60_000;
/** مخرجات ffmpeg على stderr قد تطول؛ نوسّع الحاجز حتى لا يُقطع. */
const MAX_BUFFER = 32 * 1024 * 1024;

export class FfmpegError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FfmpegError";
  }
}

async function ffmpeg(args: string[]): Promise<string> {
  try {
    const { stderr } = await run("ffmpeg", ["-nostdin", "-hide_banner", ...args], {
      timeout: TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
    });
    return stderr;
  } catch (err) {
    throw new FfmpegError(describe(err, "ffmpeg"));
  }
}

function describe(err: unknown, tool: string): string {
  if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
    return `${tool} غير مثبّت على الخادم. ثبّته ثم أعد المحاولة.`;
  }
  const stderr =
    err && typeof err === "object" && "stderr" in err ? String(err.stderr) : "";
  const tail = stderr.trim().split("\n").slice(-5).join("\n");
  return `فشل ${tool}: ${tail || (err instanceof Error ? err.message : String(err))}`;
}

export interface MediaInfo {
  durationSec: number;
  hasAudio: boolean;
}

export async function probe(path: string): Promise<MediaInfo> {
  let stdout: string;
  try {
    ({ stdout } = await run(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration:stream=codec_type",
        "-of",
        "json",
        path,
      ],
      { timeout: 60_000, maxBuffer: MAX_BUFFER },
    ));
  } catch (err) {
    throw new FfmpegError(describe(err, "ffprobe"));
  }

  const parsed = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: { codec_type?: string }[];
  };

  const durationSec = Number(parsed.format?.duration ?? 0);
  const hasAudio = (parsed.streams ?? []).some((s) => s.codec_type === "audio");

  if (!hasAudio) {
    throw new FfmpegError("الملف لا يحتوي مسارًا صوتيًا.");
  }
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new FfmpegError("تعذّر قراءة مدة الملف؛ قد يكون تالفًا.");
  }

  return { durationSec, hasAudio };
}

/**
 * تطبيع إلى WAV أحادي ‏16kHz — ما تتوقّعه محرّكات التفريغ.
 * يقلّل الحجم كثيرًا (فالحصص تُحسب بثواني الصوت لا بالبايتات) ويرفع
 * الدقة لأن المحرّك لا يعيد أخذ العيّنات بنفسه.
 */
export async function normalizeToWav(input: string, output: string): Promise<void> {
  await ffmpeg([
    "-y",
    "-i", input,
    "-vn",
    "-ac", "1",
    "-ar", "16000",
    "-c:a", "pcm_s16le",
    output,
  ]);
}

/**
 * كشف فترات الصمت — مصدر نقاط القطع (§2.3).
 * العتبة ‏-32dB وأقصر فترة ‏0.4 ثانية: تلتقط الوقفات بين الجمل
 * دون أن تتشظّى عند الوقفات القصيرة داخل الجملة.
 */
export async function detectSilence(
  path: string,
  { noiseDb = -32, minDurationSec = 0.4 } = {},
): Promise<SilenceGap[]> {
  const stderr = await ffmpeg([
    "-i", path,
    "-af", `silencedetect=noise=${noiseDb}dB:d=${minDurationSec}`,
    "-f", "null",
    "-",
  ]);
  return parseSilence(stderr);
}

/** يُصدَّر للاختبار: تحليل مخرجات silencedetect. */
export function parseSilence(stderr: string): SilenceGap[] {
  const gaps: SilenceGap[] = [];
  let pendingStart: number | null = null;

  for (const line of stderr.split("\n")) {
    const start = line.match(/silence_start:\s*(-?[\d.]+)/);
    if (start) {
      pendingStart = Math.max(0, Number(start[1]));
      continue;
    }

    const end = line.match(/silence_end:\s*([\d.]+)/);
    if (end && pendingStart !== null) {
      const endSec = Number(end[1]);
      if (endSec > pendingStart) {
        gaps.push({
          startMs: Math.round(pendingStart * 1000),
          endMs: Math.round(endSec * 1000),
        });
      }
      pendingStart = null;
    }
  }

  return gaps;
}

/** استخراج مقطع فرعي إلى WAV. */
export async function extractSegment(
  input: string,
  output: string,
  startMs: number,
  endMs: number,
): Promise<void> {
  const durationSec = (endMs - startMs) / 1000;
  if (durationSec <= 0) throw new FfmpegError("مدى المقطع الفرعي غير صالح.");

  await ffmpeg([
    "-y",
    // ‎-ss قبل ‎-i أسرع كثيرًا (بحث بالفهرس)، ودقّته كافية لأن
    // المصدر WAV غير مضغوط فلا إطارات مفتاحية تُقيّده.
    "-ss", (startMs / 1000).toFixed(3),
    "-t", durationSec.toFixed(3),
    "-i", input,
    "-ac", "1",
    "-ar", "16000",
    "-c:a", "pcm_s16le",
    output,
  ]);
}

/** يقرأ المقطع الفرعي ثم يحذفه — لا نحتفظ بالوسائط أكثر من اللازم. */
export async function readAndDiscard(path: string): Promise<Buffer> {
  const bytes = await readFile(path);
  await unlink(path).catch(() => {});
  return bytes;
}
