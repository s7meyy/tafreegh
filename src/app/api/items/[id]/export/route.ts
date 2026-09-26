import { NextResponse } from "next/server";
import { toDocx } from "@/lib/export/docx";
import { toSrt, toVtt } from "@/lib/export/subtitles";
import { safeFilename, toMarkdown, toTxt, type ExportMeta } from "@/lib/export/text";
import { bestText, exportMeta, loadItem, subtitleWords } from "@/lib/items";
import { unauthorized } from "@/lib/api";
import { requireApiUser } from "@/lib/session";

const FORMATS = ["txt", "md", "docx", "srt", "vtt"] as const;
type Format = (typeof FORMATS)[number];

const MIME: Record<Format, string> = {
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  srt: "application/x-subrip; charset=utf-8",
  vtt: "text/vtt; charset=utf-8",
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const format = new URL(request.url).searchParams.get("format") ?? "txt";

  if (!FORMATS.includes(format as Format)) {
    return NextResponse.json(
      { error: `صيغة غير مدعومة. المدعوم: ${FORMATS.join("، ")}` },
      { status: 400 },
    );
  }

  const user = await requireApiUser();
  if (!user) return unauthorized();
  const loaded = await loadItem(id, user.id);
  if (!loaded) {
    return NextResponse.json({ error: "المقطع غير موجود" }, { status: 404 });
  }

  const text = bestText(loaded.stages);
  if (!text) {
    return NextResponse.json(
      { error: "لا نصّ لهذا المقطع بعد." },
      { status: 409 },
    );
  }

  const meta = exportMeta(loaded, text);

  const { body, extension } = await render(format as Format, text, meta, loaded);
  if (!body) {
    return NextResponse.json(
      {
        error:
          "لا توقيتات لهذا المقطع، فلا يمكن تصدير بطاقات الترجمة. جرّب txt أو docx.",
      },
      { status: 409 },
    );
  }

  // المسودة تُعلَّم في اسم الملف كما في محتواه: لا تختلط بالمعتمد.
  const filename = safeFilename(meta.draft ? `${meta.title} (مسودة)` : meta.title, extension);
  return new NextResponse(body as BodyInit, {
    headers: {
      "content-type": MIME[format as Format],
      // filename* بترميز UTF-8 ليسلم الاسم العربي عبر المتصفحات.
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}

async function render(
  format: Format,
  text: string,
  meta: ExportMeta,
  loaded: NonNullable<Awaited<ReturnType<typeof loadItem>>>,
): Promise<{ body: string | Uint8Array | null; extension: string }> {
  switch (format) {
    case "txt":
      return { body: toTxt(text, meta), extension: "txt" };
    case "md":
      return { body: toMarkdown(text, meta), extension: "md" };
    case "docx":
      return { body: new Uint8Array(await toDocx(text, meta)), extension: "docx" };
    case "srt":
    case "vtt": {
      // بطاقات الترجمة تحتاج توقيتات. هي محفوظة في قاعدة البيانات لا
      // في ملف الصوت، فتبقى متاحة بعد حذف الوسائط.
      const words = subtitleWords(loaded.stages);
      if (words.length === 0) return { body: null, extension: format };
      return {
        body: format === "srt" ? toSrt(words) : toVtt(words),
        extension: format,
      };
    }
  }
}
