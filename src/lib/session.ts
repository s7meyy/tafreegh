import { eq, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { users } from "@/db/schema";
import { SESSION_COOKIE, readSession } from "./auth";

/**
 * المستخدم الحالي من كوكي الجلسة.
 *
 * كل استعلام في المشروع مقيّد بـ `userId` المعاد من هنا، فالعزل في
 * طبقة البيانات لا في الواجهة — ولا يكشفه خطأ في مسار جديد.
 */
export async function getCurrentUser() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = readSession(token);
  if (!session) return null;

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1);

  return user ?? null;
}

/**
 * المستخدم أو إعادة توجيه. تُستعمل في الصفحات.
 * بلا حسابات بعد، توجّه إلى الإعداد لا إلى الدخول.
 */
export async function requireUser() {
  const user = await getCurrentUser();
  if (user) return user;

  redirect((await hasAnyUser()) ? "/login" : "/setup");
}

/** المستخدم أو `null`. تُستعمل في مسارات API لتردّ 401 لا إعادة توجيه. */
export async function requireApiUser() {
  return getCurrentUser();
}

export async function hasAnyUser(): Promise<boolean> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(users);
  return (row?.count ?? 0) > 0;
}
