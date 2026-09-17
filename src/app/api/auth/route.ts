import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import {
  SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS,
  hashPassword,
  signSession,
  validatePassword,
  verifyPassword,
} from "@/lib/auth";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { hasAnyUser } from "@/lib/session";

const credentials = z.object({
  email: z.string().email("بريد غير صالح"),
  password: z.string().min(1, "كلمة المرور مطلوبة"),
  name: z.string().trim().max(80).optional(),
  /** `setup` ينشئ أول حساب، و`login` يدخل بحساب قائم */
  action: z.enum(["login", "setup"]).default("login"),
});

/** عشر محاولات في الربع ساعة لكل عنوان. */
const ATTEMPT_LIMIT = 10;
const ATTEMPT_WINDOW_SEC = 900;

export async function POST(request: Request) {
  // الحدّ قبل قراءة الجسم وقبل scrypt: كلاهما يكلّف، والغرض ألا يكلّف
  // المهاجمُ الخادمَ شيئًا.
  const limited = await rateLimit(
    `auth:${clientKey(request)}`,
    ATTEMPT_LIMIT,
    ATTEMPT_WINDOW_SEC,
  );

  if (!limited.ok) {
    const minutes = Math.ceil(limited.retryAfterMs / 60_000);
    return NextResponse.json(
      { error: `محاولات كثيرة. انتظر ${minutes} دقيقة ثم أعد المحاولة.` },
      {
        status: 429,
        headers: { "retry-after": String(Math.ceil(limited.retryAfterMs / 1000)) },
      },
    );
  }

  const parsed = credentials.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" },
      { status: 400 },
    );
  }

  const { email, password, name, action } = parsed.data;
  const normalizedEmail = email.trim().toLowerCase();

  if (action === "setup") return setup(normalizedEmail, password, name);
  return login(normalizedEmail, password);
}

/** الخروج: يمحو الكوكي. */
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { ...SESSION_COOKIE_OPTIONS, maxAge: 0 });
  return res;
}

async function setup(email: string, password: string, name?: string) {
  // الإعداد متاح ما لم يوجد حساب. بعد أول حساب يُغلق الباب، وإلا
  // لأنشأ أيّ زائر حسابًا لنفسه على موقع مكشوف.
  if (await hasAnyUser()) {
    return NextResponse.json(
      { error: "الإعداد تمّ سلفًا. سجّل الدخول." },
      { status: 409 },
    );
  }

  const weak = validatePassword(password);
  if (weak) return NextResponse.json({ error: weak }, { status: 400 });

  const [user] = await db
    .insert(users)
    .values({ email, name: name || null, passwordHash: await hashPassword(password) })
    .returning();

  if (!user) {
    return NextResponse.json({ error: "تعذّر إنشاء الحساب" }, { status: 500 });
  }

  return withSession(user.id);
}

async function login(email: string, password: string) {
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

  // نتحقّق من كلمة المرور ولو لم يوجد المستخدم، بقيمة وهمية: الردّ
  // السريع على بريد مجهول يكشف أي البُرد مسجّلة.
  const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);

  if (!user || !ok) {
    return NextResponse.json(
      { error: "البريد أو كلمة المرور غير صحيحة." },
      { status: 401 },
    );
  }

  return withSession(user.id);
}

function withSession(userId: string) {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, signSession(userId), SESSION_COOKIE_OPTIONS);
  return res;
}

/** تجزئة صالحة الشكل لا تطابق شيئًا — لتوحيد زمن الردّ. */
const DUMMY_HASH = `${"0".repeat(32)}:${"0".repeat(128)}`;
