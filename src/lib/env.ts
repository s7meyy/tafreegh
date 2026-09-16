import { z } from "zod";

/**
 * تحقّق من متغيرات البيئة عند الإقلاع.
 * الفشل هنا خير من فشلٍ في منتصف مهمة تفريغ طويلة.
 */
const schema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().default("redis://localhost:6379"),
  STORAGE_DIR: z.string().default("./storage"),

  GROQ_API_KEY: z.string().optional(),
  GROQ_ASR_MODEL: z.string().default("whisper-large-v3"),

  GEMINI_API_KEY: z.string().optional(),
  GEMINI_ASR_MODEL: z.string().default("gemini-2.5-flash"),
  GEMINI_REVIEW_MODEL: z.string().default("gemini-2.5-flash"),
  GEMINI_AUDIT_MODEL: z.string().default("gemini-2.5-pro"),

  OLLAMA_BASE_URL: z.string().default("http://localhost:11434"),
  OLLAMA_MODEL: z.string().default("qwen3:8b"),

  CONCURRENCY_PREPARE: z.coerce.number().int().positive().default(2),
  CONCURRENCY_TRANSCRIBE: z.coerce.number().int().positive().default(4),
  CONCURRENCY_REVIEW: z.coerce.number().int().positive().default(3),
  CONCURRENCY_AUDIT: z.coerce.number().int().positive().default(2),

  ENABLE_YOUTUBE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  MEDIA_TTL_DAYS: z.coerce.number().int().positive().default(14),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((i) => `  • ${i.path.join(".")}: ${i.message}`)
        .join("\n");
      throw new Error(`متغيرات البيئة غير صحيحة:\n${issues}`);
    }
    cached = parsed.data;
  }
  return cached;
}
