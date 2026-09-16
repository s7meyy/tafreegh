import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";
import * as schema from "./schema";

declare global {
  // eslint-disable-next-line no-var
  var __tafreeghSql: ReturnType<typeof postgres> | undefined;
}

// في التطوير يعيد Next تحميل الوحدات كثيرًا؛ نعيد استخدام الاتصال
// حتى لا تتراكم مجمّعات اتصال مهجورة.
const sql = globalThis.__tafreeghSql ?? postgres(env().DATABASE_URL, { max: 10 });
if (process.env.NODE_ENV !== "production") globalThis.__tafreeghSql = sql;

export const db = drizzle(sql, { schema });
export { schema };
