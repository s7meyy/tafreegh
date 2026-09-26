import { NextResponse } from "next/server";
import { z } from "zod";
import { unauthorized } from "@/lib/api";
import type { Enrichment } from "@/lib/enrich/types";
import { bestText, loadItem } from "@/lib/items";
import { enqueueEnrich } from "@/lib/queue";
import { isReviewConfigured } from "@/lib/review/provider";
import { requireApiUser } from "@/lib/session";
import { setEnrichment } from "@/lib/enrich/store";

const schema = z.object({
  kind: z.enum(["summary", "tashkeel"]),
  mode: z.enum(["full", "light"]).default("full"),
});

/**
 * طلب ملخص أو تشكيل. يُدرج في طابور العامل ويعود فورًا: التشكيل على
 * نصّ طويل عشرات النداءات، وقد يمتدّ إلى الغد إن نفدت الحصة.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireApiUser();
  if (!user) return unauthorized();

  const loaded = await loadItem(id, user.id);
  if (!loaded) return NextResponse.json({ error: "المقطع غير موجود" }, { status: 404 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "طلب غير صالح" }, { status: 400 });

  if (!bestText(loaded.stages)) {
    return NextResponse.json({ error: "لا نصّ لهذا المقطع بعد." }, { status: 409 });
  }
  const local = loaded.project.profile === "local_only";
  if (!isReviewConfigured(local)) {
    return NextResponse.json(
      {
        error: local
          ? "وضع «مشروع خاص» يحتاج Ollama شغّالًا."
          : "يحتاج نموذج المراجعة — اضبط GEMINI_API_KEY.",
      },
      { status: 409 },
    );
  }

  const { kind, mode } = parsed.data;
  const current = ((loaded.item.enrichment ?? {}) as Enrichment)[kind];

  if (kind === "tashkeel") {
    // تغيير النمط يبدأ من الصفر؛ النمط نفسه يُستأنف مما أُنجز
    const tashkeel = current as Enrichment["tashkeel"];
    const same = tashkeel?.mode === mode;
    await setEnrichment(id, "tashkeel", {
      ...(same ? tashkeel : {}),
      mode,
      status: "queued",
      error: undefined,
    });
  } else {
    await setEnrichment(id, "summary", { ...current, status: "queued", error: undefined });
  }

  await enqueueEnrich(id, kind);
  return NextResponse.json({ ok: true });
}
