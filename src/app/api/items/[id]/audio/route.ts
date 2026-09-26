import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { unauthorized } from "@/lib/api";
import { loadItem } from "@/lib/items";
import { requireApiUser } from "@/lib/session";
import { itemMediaDir } from "@/lib/storage";

/**
 * صوت المقطع للاستماع إلى المواضع المشكوك فيها قبل الاعتماد.
 *
 * يُخدم بطلبات المدى (Range): المشغّل يقفز إلى الثانية المطلوبة فلا
 * يُنزَّل التسجيل كله. والملف هو النسخة المطبَّعة (16 كيلوهرتز أحادية)
 * — أصغر من الأصل، وهي ما سمعه المحرّك بالضبط. بعد الاعتماد تُحذف،
 * فيعيد المسار 410.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const user = await requireApiUser();
  if (!user) return unauthorized();

  const loaded = await loadItem(id, user.id);
  if (!loaded) return NextResponse.json({ error: "المقطع غير موجود" }, { status: 404 });
  if (loaded.item.mediaDeletedAt) {
    return NextResponse.json({ error: "حُذف صوت هذا المقطع بعد اعتماده." }, { status: 410 });
  }

  // المسار يُبنى من معرّف المقطع لا مما في قاعدة البيانات: لا يُخدم إلا
  // ما في مجلد المقطع نفسه.
  const path = join(itemMediaDir(id), "normalized.wav");
  const info = await stat(path).catch(() => null);
  if (!info) {
    return NextResponse.json({ error: "الصوت غير جاهز بعد." }, { status: 404 });
  }

  const size = info.size;
  const range = request.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
  const headers: Record<string, string> = {
    "content-type": "audio/wav",
    "accept-ranges": "bytes",
    "cache-control": "private, no-store",
  };

  if (!range || (!range[1] && !range[2])) {
    headers["content-length"] = String(size);
    return new Response(toWeb(path), { headers });
  }

  let start: number;
  let end: number;
  if (range[1]) {
    start = Number(range[1]);
    end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
  } else {
    // «bytes=-500»: آخر 500 بايت
    start = Math.max(0, size - Number(range[2]));
    end = size - 1;
  }

  if (start >= size || start > end) {
    return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
  }

  headers["content-range"] = `bytes ${start}-${end}/${size}`;
  headers["content-length"] = String(end - start + 1);
  return new Response(toWeb(path, start, end), { status: 206, headers });
}

function toWeb(path: string, start?: number, end?: number): ReadableStream {
  return Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream;
}
