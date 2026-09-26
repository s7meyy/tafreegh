import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { items, projects, transcripts } from "@/db/schema";
import { summarize } from "@/lib/enrich/summary";
import { batches, diacritizeBatch } from "@/lib/enrich/tashkeel";
import { guardTashkeel } from "@/lib/enrich/tashkeel-guard";
import {
  fingerprint,
  type EnrichKind,
  type Enrichment,
  type TashkeelState,
} from "@/lib/enrich/types";
import { setEnrichment } from "@/lib/enrich/store";
import { bestText, timedParagraphs, timedWords } from "@/lib/items";
import { speakersIn, splitParagraphs, splitSpeaker, withSpeaker } from "@/lib/transcript/speakers";

/**
 * الإضافات على النصّ: الملخص والتشكيل.
 *
 * تعمل على أفضل نصّ محفوظ (المعتمد إن وُجد، وإلا نصّ التدقيق). وحالتها
 * منفصلة عن حالة المقطع: فشلُ ملخص لا يجعل المقطع «فاشلًا».
 */

async function load(itemId: string) {
  const [row] = await db
    .select({ item: items, project: projects })
    .from(items)
    .innerJoin(projects, eq(projects.id, items.projectId))
    .where(eq(items.id, itemId))
    .limit(1);
  if (!row) throw new Error(`المقطع ${itemId} غير موجود`);

  const stages = await db
    .select()
    .from(transcripts)
    .where(and(eq(transcripts.itemId, itemId), isNull(transcripts.segmentId)))
    .orderBy(asc(transcripts.createdAt));

  const text = bestText(stages);
  if (!text) throw new Error("لا نصّ لهذا المقطع بعد.");
  return {
    ...row,
    stages,
    text,
    local: row.project.profile === "local_only",
    enrichment: (row.item.enrichment ?? {}) as Enrichment,
  };
}

export async function enrichItem(itemId: string, kind: EnrichKind): Promise<void> {
  if (kind === "summary") return summaryItem(itemId);
  return tashkeelItem(itemId);
}

async function summaryItem(itemId: string): Promise<void> {
  const { text, stages, local } = await load(itemId);
  const source = fingerprint(text);
  await setEnrichment(itemId, "summary", { status: "running", source });

  const paragraphs = splitParagraphs(text);
  const data = await summarize(paragraphs, local);

  // توقيت كل نقطة من أول فقراتها — لتُسمع منه
  const { starts } = timedParagraphs(text, timedWords(stages));
  for (const point of data.points) {
    point.startMs = point.paras.length ? (starts[point.paras[0]! - 1] ?? null) : null;
  }

  await setEnrichment(itemId, "summary", {
    status: "done",
    source,
    data,
    at: new Date().toISOString(),
  });
}

async function tashkeelItem(itemId: string): Promise<void> {
  const { text, local, enrichment } = await load(itemId);
  const source = fingerprint(text);
  const previous = enrichment.tashkeel;
  const mode = previous?.mode ?? "full";

  const known = speakersIn(text);
  const parts = splitParagraphs(text).map((p) => splitSpeaker(p, known));
  const bodies = parts.map((p) => p.body);

  // استئناف: ما أُنجز من النصّ نفسه وبالنمط نفسه يُبنى عليه
  const resume = previous?.source === source && previous.mode === mode;
  const done = resume ? [...(previous.done ?? [])] : [];
  let rejected = resume ? (previous.rejectedWords ?? 0) : 0;

  const state = (): TashkeelState => ({
    status: "running",
    mode,
    source,
    done,
    total: bodies.length,
    rejectedWords: rejected,
  });
  await setEnrichment(itemId, "tashkeel", state());

  for (const batch of batches(bodies)) {
    if (batch[batch.length - 1]! < done.length) continue;
    const pending = batch.filter((i) => i >= done.length);
    const input = pending.map((i) => bodies[i]!);
    const output = await diacritizeBatch(input, mode, local);

    input.forEach((original, k) => {
      // دفعة أعادت فقرات أقل: الناقصة تبقى بلا تشكيل ولا تُزاح غيرها
      const guarded = guardTashkeel(original, output[k] ?? original);
      rejected += guarded.rejected;
      done.push(guarded.text);
    });
    await setEnrichment(itemId, "tashkeel", state());
  }

  await setEnrichment(itemId, "tashkeel", {
    status: "done",
    mode,
    source,
    total: bodies.length,
    rejectedWords: rejected,
    text: done.map((body, i) => withSpeaker(body, parts[i]!.speaker)).join("\n\n"),
    at: new Date().toISOString(),
  });
}
