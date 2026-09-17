/**
 * رافع مجزّأ مستأنف (جانب العميل).
 *
 * الانقطاع في رفع ملف بحجم غيغابايت أمر عادي لا استثناء. فالرافع
 * يعيد المحاولة بتراجع أسّي، ويسأل الخادم كم استلم قبل أن يكمل —
 * فلا يعيد ما وصل.
 */

export interface UploadProgress {
  sent: number;
  total: number;
}

export interface UploadOutcome {
  itemId: string;
  duplicate: boolean;
}

const MAX_ATTEMPTS = 5;

export async function uploadFile(
  file: File,
  projectId: string,
  onProgress?: (progress: UploadProgress) => void,
  signal?: AbortSignal,
): Promise<UploadOutcome> {
  const init = await fetch("/api/uploads", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      projectId,
      filename: file.name,
      size: file.size,
      type: file.type,
    }),
    signal,
  });

  const initBody = await init.json().catch(() => ({}));
  if (!init.ok) throw new Error(initBody.error ?? "تعذّر بدء الرفع.");

  const { id, chunkBytes } = initBody as { id: string; chunkBytes: number };

  let offset = 0;
  let attempt = 0;

  while (offset < file.size) {
    signal?.throwIfAborted();

    const end = Math.min(offset + chunkBytes, file.size);
    const chunk = file.slice(offset, end);

    try {
      const res = await fetch(`/api/uploads/${id}?offset=${offset}`, {
        method: "PUT",
        body: chunk,
        signal,
      });
      const body = await res.json().catch(() => ({}));

      if (res.status === 409 && typeof body.received === "number") {
        // الخادم يعرف موضعه الحقيقي؛ نتبعه بدل أن نصرّ على حسابنا.
        offset = body.received;
        continue;
      }
      if (!res.ok) throw new Error(body.error ?? `فشل رفع القطعة (${res.status})`);

      offset = body.received ?? end;
      attempt = 0;
      onProgress?.({ sent: offset, total: file.size });

      if (body.complete) {
        return { itemId: body.itemId, duplicate: Boolean(body.duplicate) };
      }
    } catch (err) {
      if (signal?.aborted) throw err;
      if (++attempt >= MAX_ATTEMPTS) throw err;

      await sleep(2 ** attempt * 500);
      // نسأل الخادم أين وصل: قد تكون القطعة وصلت والردّ هو الذي ضاع.
      offset = await resumeOffset(id, offset);
    }
  }

  throw new Error("انتهى الملف دون أن يؤكّد الخادم اكتماله.");
}

async function resumeOffset(id: string, fallback: number): Promise<number> {
  try {
    const res = await fetch(`/api/uploads/${id}`);
    if (!res.ok) return fallback;
    const body = (await res.json()) as { received?: number };
    return typeof body.received === "number" ? body.received : fallback;
  } catch {
    return fallback;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
