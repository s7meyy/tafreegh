import {
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { env } from "./env";

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const KEY_LENGTH = 64;
const SESSION_DAYS = 30;

/**
 * كلمات المرور والجلسات.
 *
 * scrypt لا SHA: دالة التجزئة السريعة تجعل تخمين كلمات المرور رخيصًا
 * لمن يحصل على قاعدة البيانات. وscrypt مبنيّ في Node فلا يحتاج تبعية.
 *
 * الجلسة كوكي موقّع لا صفّ في قاعدة البيانات: الاستخدام شخصي، والتحقق
 * بلا استعلام أسرع وأبسط. وثمن ذلك أن إبطال جلسة بعينها غير ممكن —
 * تغيير AUTH_SECRET يُبطل الجلسات كلها، وهو ما يكفي هنا.
 */

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEY_LENGTH);
  return `${salt.toString("hex")}:${key.toString("hex")}`;
}

export async function verifyPassword(
  password: string,
  stored: string | null,
): Promise<boolean> {
  if (!stored) return false;

  const [saltHex, keyHex] = stored.split(":");
  if (!saltHex || !keyHex) return false;

  const expected = Buffer.from(keyHex, "hex");
  const actual = await scrypt(password, Buffer.from(saltHex, "hex"), KEY_LENGTH);

  // المقارنة ثابتة الزمن: المقارنة العادية تسرّب طول البادئة المطابقة.
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

export interface SessionPayload {
  userId: string;
  exp: number;
}

export function signSession(userId: string): string {
  const payload: SessionPayload = {
    userId,
    exp: Date.now() + SESSION_DAYS * 86_400_000,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function readSession(token: string | undefined): SessionPayload | null {
  if (!token) return null;

  const [body, signature] = token.split(".");
  if (!body || !signature) return null;

  const expected = sign(body);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString(),
    ) as SessionPayload;
    if (!payload.userId || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function sign(body: string): string {
  return createHmac("sha256", env().AUTH_SECRET).update(body).digest("base64url");
}

export const SESSION_COOKIE = "tafreegh_session";

export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax",
  path: "/",
  maxAge: SESSION_DAYS * 86_400,
  // على HTTP في التطوير المحلي لا يُرسل الكوكي الآمن، فنشترطه في الإنتاج وحده.
  secure: process.env.NODE_ENV === "production",
} as const;

/** أدنى ما نقبله. الطول أنفع من تعقيد الرموز في مقاومة التخمين. */
export function validatePassword(password: string): string | null {
  if (password.length < 12) return "كلمة المرور يجب ألا تقل عن 12 حرفًا.";
  return null;
}
