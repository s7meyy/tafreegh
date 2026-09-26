import { z } from "zod";

/**
 * تحقّق من متغيرات البيئة عند الإقلاع.
 * الفشل هنا خير من فشلٍ في منتصف مهمة تفريغ طويلة.
 */
const schema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().default("redis://localhost:6379"),
  STORAGE_DIR: z.string().default("./storage"),

  /**
   * سرّ توقيع الجلسات. تغييره يُبطل كل الجلسات القائمة.
   * الفشل هنا مقصود: موقع بلا سرّ موقع بلا حماية.
   */
  AUTH_SECRET: z
    .string()
    .min(32, "AUTH_SECRET يجب ألا يقل عن 32 حرفًا — ولّده بـ: openssl rand -base64 32"),

  GROQ_API_KEY: z.string().optional(),
  GROQ_ASR_MODEL: z.string().default("whisper-large-v3"),

  GEMINI_API_KEY: z.string().optional(),
  GEMINI_ASR_MODEL: z.string().default("gemini-2.5-flash"),
  GEMINI_REVIEW_MODEL: z.string().default("gemini-2.5-flash"),
  GEMINI_AUDIT_MODEL: z.string().default("gemini-2.5-pro"),

  OLLAMA_BASE_URL: z.string().default("http://localhost:11434"),
  OLLAMA_MODEL: z.string().default("qwen3:8b"),

  /** التفريغ المحلي لوضع «مشروع خاص». فارغ = معطّل. */
  LOCAL_ASR_COMMAND: z.string().optional(),
  LOCAL_ASR_MODEL: z.string().default("large-v3"),

  CONCURRENCY_PREPARE: z.coerce.number().int().positive().default(2),
  CONCURRENCY_TRANSCRIBE: z.coerce.number().int().positive().default(4),
  CONCURRENCY_REVIEW: z.coerce.number().int().positive().default(3),
  CONCURRENCY_AUDIT: z.coerce.number().int().positive().default(2),

  ENABLE_YOUTUBE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  MEDIA_TTL_DAYS: z.coerce.number().int().positive().default(14),

  /**
   * وضع العرض التجريبي: محرّكان ومراجع محاكاة بدل المزوّدين الحقيقيين.
   * لتجربة الدورة كاملة بلا مفاتيح. لا يُفعَّل في الإنتاج أبدًا —
   * مخرجاته محاكاة لا تفريغ.
   */
  DEMO_MODE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  DEMO_SCRIPT: z.string().default("./eval/demo/script.json"),
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
