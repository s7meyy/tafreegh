import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { env } from "@/lib/env";
import type { TranscriptResult, Word } from "@/lib/transcript/types";
import { ProviderError, type TranscribeInput, type TranscriptionProvider } from "./types";

const run = promisify(execFile);

/**
 * التفريغ المحلي — عماد وضع «مشروع خاص».
 *
 * المقطع لا يغادر الخادم: لا مزوّد، ولا حصة، ولا سياسة بيانات تدريب.
 * أبطأ وأقل دقة من المسار السحابي، وهذا ثمن الخصوصية لا عيب في التنفيذ
 * (§3.4 من الخطة).
 *
 * يُستدعى `whisper-ctranslate2` (faster-whisper) بأمر قابل للضبط، فمن
 * أراد محرّكًا محليًا آخر بدّل الأمر ولم يبدّل الكود.
 */
export class LocalWhisperProvider implements TranscriptionProvider {
  readonly name = "local";
  readonly isRemote = false;
  readonly model: string;

  constructor(
    private readonly command = env().LOCAL_ASR_COMMAND,
    model = env().LOCAL_ASR_MODEL,
  ) {
    this.model = model;
  }

  isConfigured(): boolean {
    return Boolean(this.command);
  }

  async transcribe(input: TranscribeInput): Promise<TranscriptResult> {
    if (!this.command) {
      throw new ProviderError("LOCAL_ASR_COMMAND غير مضبوط", {
        provider: this.name,
        retryable: false,
      });
    }

    // مجلد مؤقت مستقل لكل نداء: نداءان متوازيان يكتبان الاسم نفسه.
    const dir = await mkdtemp(join(tmpdir(), "tafreegh-"));
    try {
      const audioPath = join(dir, "audio.wav");
      await writeFile(audioPath, input.audio);

      await run(
        this.command,
        [
          audioPath,
          "--model", this.model,
          "--language", input.languageHint ?? "ar",
          "--output_format", "json",
          "--output_dir", dir,
          "--word_timestamps", "True",
          ...(input.glossary?.length
            ? ["--initial_prompt", input.glossary.join("، ")]
            : []),
        ],
        { timeout: 60 * 60_000, maxBuffer: 32 * 1024 * 1024 },
      );

      const raw = await readFile(join(dir, "audio.json"), "utf8");
      return this.parse(JSON.parse(raw) as WhisperJson, input.audioSeconds);
    } catch (err) {
      throw this.toError(err);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  private parse(body: WhisperJson, audioSeconds: number): TranscriptResult {
    const words: Word[] = [];

    for (const segment of body.segments ?? []) {
      // الثقة على مستوى المقطع كما في Groq، فتُسقط على كلماته.
      const confidence =
        segment.avg_logprob === undefined
          ? undefined
          : Math.min(1, Math.exp(segment.avg_logprob));

      for (const word of segment.words ?? []) {
        words.push({
          text: word.word.trim(),
          startMs: Math.round(word.start * 1000),
          endMs: Math.round(word.end * 1000),
          confidence,
        });
      }
    }

    const scored = words.filter((w) => w.confidence !== undefined);

    return {
      text: (body.text ?? "").trim(),
      words,
      avgConfidence:
        scored.length > 0
          ? scored.reduce((s, w) => s + w.confidence!, 0) / scored.length
          : undefined,
      engine: this.name,
      model: this.model,
      audioSeconds,
    };
  }

  private toError(err: unknown): ProviderError {
    if (err instanceof ProviderError) return err;

    if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
      return new ProviderError(
        `${this.command} غير مثبّت. ثبّت faster-whisper أو غيّر LOCAL_ASR_COMMAND.`,
        { provider: this.name, retryable: false },
      );
    }

    const stderr =
      err && typeof err === "object" && "stderr" in err ? String(err.stderr) : "";
    const tail = stderr.trim().split("\n").slice(-3).join(" ");

    return new ProviderError(
      `فشل التفريغ المحلي: ${tail || (err instanceof Error ? err.message : "خطأ غير معروف")}`,
      { provider: this.name, retryable: false },
    );
  }
}

interface WhisperJson {
  text?: string;
  segments?: {
    avg_logprob?: number;
    words?: { word: string; start: number; end: number }[];
  }[];
}
