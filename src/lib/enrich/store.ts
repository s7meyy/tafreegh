import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { items } from "@/db/schema";
import type { EnrichKind, SummaryState, TashkeelState } from "./types";

/** تحديث مفتاح واحد في `enrichment` ذرّيًا — الملخص والتشكيل قد يعملان معًا. */
export async function setEnrichment(
  itemId: string,
  kind: EnrichKind,
  value: SummaryState | TashkeelState,
): Promise<void> {
  await db
    .update(items)
    .set({
      enrichment: sql`coalesce(${items.enrichment}, '{}'::jsonb) || jsonb_build_object(${kind}::text, ${JSON.stringify(value)}::jsonb)`,
    })
    .where(eq(items.id, itemId));
}

