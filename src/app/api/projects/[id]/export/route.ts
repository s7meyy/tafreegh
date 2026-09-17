import { and, eq, inArray } from "drizzle-orm";
import JSZip from "jszip";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { items, projects } from "@/db/schema";
import { toDocx } from "@/lib/export/docx";
import { toSrt, toVtt } from "@/lib/export/subtitles";
import { safeFilename, toMarkdown, toTxt, type ExportMeta } from "@/lib/export/text";
import { bestText, loadItem, timedWords } from "@/lib/items";
import { getCurrentUser } from "@/lib/session";

const FORMATS = ["txt", "md", "docx", "srt", "vtt"] as const;
type Format = (typeof FORMATS)[number];

const schema = z.object({
  itemIds: z.array(z.string().uuid()).min(1).max(500),
  format: z.enum(FORMATS).default("txt"),
});

/**
 * التصدير الجماعي في ملف مضغوط واحد.
 *
 * مقطع بلا نصّ لا يُسقط الطلب كله: يُذكر في ملف `تعذّر.txt` داخل
 * المضغوط. من صدّر ثلاثين مقطعًا يريد التسعة والعشرين الجاهزة، وأن
 * يعرف أيّها لم يجهز.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  const user = await getCurrentUser();

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "بيانات غير صحيحة" }, { status: 400 });
  }

  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
    .limit(1);

  if (!project) {
    return NextResponse.json({ error: "المجلد غير موجود" }, { status: 404 });
  }

  // الاستعلام مقيّد بالمجلد: معرّف من مجلد آخر لا يُصدَّر ولو أُرسل.
  const owned = await db
    .select({ id: items.id })
    .from(items)
    .where(and(eq(items.projectId, projectId), inArray(items.id, parsed.data.itemIds)));

  if (owned.length === 0) {
    return NextResponse.json({ error: "لا مقاطع مطابقة" }, { status: 404 });
  }

  const zip = new JSZip();
  const skipped: string[] = [];
  const used = new Set<string>();

  for (const row of owned) {
    const loaded = await loadItem(row.id, user.id);
    if (!loaded) continue;

    const text = bestText(loaded.stages);
    if (!text) {
      skipped.push(`${loaded.item.title} — لا نصّ بعد`);
      continue;
    }

    const meta: ExportMeta = {
      title: loaded.item.title,
      project: project.name,
      mode: project.transcriptionMode,
      durationSec: loaded.item.durationSec,
      approvedAt: loaded.item.approvedAt,
    };

    const rendered = await renderOne(parsed.data.format, text, meta, loaded);
    if (!rendered) {
      skipped.push(`${loaded.item.title} — لا توقيتات لبطاقات الترجمة`);
      continue;
    }

    zip.file(uniqueName(used, meta.title, parsed.data.format), rendered);
  }

  if (skipped.length > 0) {
    zip.file("تعذّر.txt", `لم تُصدَّر هذه المقاطع:\n\n${skipped.join("\n")}\n`);
  }

  const blob = await zip.generateAsync({ type: "uint8array" });
  const filename = safeFilename(project.name, "zip");

  return new NextResponse(blob as unknown as BodyInit, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}

async function renderOne(
  format: Format,
  text: string,
  meta: ExportMeta,
  loaded: NonNullable<Awaited<ReturnType<typeof loadItem>>>,
): Promise<string | Uint8Array | null> {
  switch (format) {
    case "txt":
      return toTxt(text, meta);
    case "md":
      return toMarkdown(text, meta);
    case "docx":
      return new Uint8Array(await toDocx(text, meta));
    case "srt":
    case "vtt": {
      const words = timedWords(loaded.stages);
      if (words.length === 0) return null;
      return format === "srt" ? toSrt(words) : toVtt(words);
    }
  }
}

/** مقطعان بالعنوان نفسه واردان؛ الثاني يأخذ لاحقة بدل أن يمحو الأول. */
function uniqueName(used: Set<string>, title: string, format: string): string {
  const base = safeFilename(title, format);
  if (!used.has(base)) {
    used.add(base);
    return base;
  }

  for (let i = 2; ; i++) {
    const candidate = safeFilename(`${title} (${i})`, format);
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
}
