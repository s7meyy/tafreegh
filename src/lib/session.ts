import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";

/**
 * المستخدم الحالي.
 *
 * تسجيل الدخول مؤجّل إلى م6 (§9 من الخطة). إلى حينها يعمل الموقع
 * بمستخدم محلي واحد يُنشأ عند الحاجة. كل الاستعلامات مقيّدة بـ
 * `userId` منذ الآن، فإضافة الدخول لاحقًا لن تمسّ طبقة البيانات.
 */
const LOCAL_EMAIL = "local@tafreegh.local";

export async function getCurrentUser() {
  const existing = await db
    .select()
    .from(users)
    .where(eq(users.email, LOCAL_EMAIL))
    .limit(1);

  if (existing[0]) return existing[0];

  const [created] = await db
    .insert(users)
    .values({ email: LOCAL_EMAIL, name: "المستخدم المحلي" })
    .onConflictDoNothing()
    .returning();

  if (created) return created;

  // سباق بين طلبين متزامنين: الصف أُنشئ بالفعل، فنقرأه.
  const [row] = await db
    .select()
    .from(users)
    .where(eq(users.email, LOCAL_EMAIL))
    .limit(1);
  if (!row) throw new Error("تعذّر إنشاء المستخدم المحلي");
  return row;
}
