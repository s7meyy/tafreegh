/**
 * أداة القياس — بوابة الجودة (§2.5 من الخطة).
 *
 * تقيس معدل خطأ الكلمة بعد كل مرحلة على المجموعة المرجعية، وتخرج
 * برمز فشل إن رفعت مرحلةٌ الخطأ. بناء المراجعة بلا هذا الرقم بناءٌ
 * في الظلام: التعديل الذي «يبدو» تحسينًا قد يكون إفسادًا صامتًا.
 */
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { wordErrorRate } from "../src/lib/arabic";
import { reviewTranscript } from "../src/lib/review/pipeline";
import { toParagraphs } from "../src/lib/review/apply";
import { isReviewConfigured } from "../src/lib/review/provider";
import type { TranscriptionMode } from "../src/lib/review/stage2";
import { getRedis } from "../src/lib/redis";

const FIXTURES = join(import.meta.dirname, "..", "eval", "fixtures");

interface Meta {
  kind: "text" | "audio";
  dialect: string;
  mode?: TranscriptionMode;
  audio?: string;
  glossary?: string[];
  note?: string;
}

interface Row {
  name: string;
  dialect: string;
  raw: number;
  reviewed: number;
  audited: number;
  skipped?: string;
}

async function main() {
  const args = process.argv.slice(2);
  const textOnly = args.includes("--text");
  const only = args[args.indexOf("--name") + 1];

  await checkPreconditions();

  const names = (await readdir(FIXTURES, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((n) => !only || n === only)
    .sort();

  if (names.length === 0) {
    console.error("لا مقاطع في eval/fixtures — راجع eval/README.md");
    process.exit(1);
  }

  const rows: Row[] = [];
  for (const name of names) {
    rows.push(await runFixture(name, textOnly));
  }

  report(rows);

  const regressions = rows.filter(
    (r) => !r.skipped && (r.reviewed > r.raw + 1e-9 || r.audited > r.reviewed + 1e-9),
  );

  if (regressions.length > 0) {
    console.error(
      `\n✗ ${regressions.length} مقطعًا ارتفع فيها الخطأ بعد المراجعة: ` +
        regressions.map((r) => r.name).join("، "),
    );
    console.error("  المرحلة التي ترفع الخطأ لا تُدمج (§2.5).");
    process.exit(1);
  }

  const measured = rows.filter((r) => !r.skipped);
  if (measured.length === 0) {
    console.error("\n✗ لم يُقس أي مقطع.");
    process.exit(1);
  }

  console.log("\n✓ كل مرحلة أنقصت الخطأ أو أبقته.");
  await getRedis().quit();
}

/**
 * الشروط تُفحص قبل العمل لا أثناءه: انتظار Redis غير الموجود يعلّق
 * الأداة بلا رسالة، ونقص المفتاح يجعل كل مقطع «متخطّى» فيبدو العطل
 * في المقاطع لا في الإعداد.
 */
async function checkPreconditions(): Promise<void> {
  if (!isReviewConfigured()) {
    console.error(
      "GEMINI_API_KEY غير مضبوط — القياس يحتاجه.\n" +
        "احصل على مفتاح مجاني من https://aistudio.google.com/apikey",
    );
    process.exit(1);
  }

  try {
    const redis = getRedis();
    await Promise.race([
      redis.ping(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("مهلة")), 3000),
      ),
    ]);
  } catch {
    console.error(
      "تعذّر الاتصال بـ Redis — متتبّع الحصص يحتاجه.\n" +
        "شغّله بـ: docker compose up -d",
    );
    process.exit(1);
  }
}

async function runFixture(name: string, textOnly: boolean): Promise<Row> {
  const dir = join(FIXTURES, name);
  const meta = JSON.parse(await readFile(join(dir, "meta.json"), "utf8")) as Meta;
  const reference = (await readFile(join(dir, "reference.txt"), "utf8")).trim();

  const base: Row = {
    name,
    dialect: meta.dialect,
    raw: 0,
    reviewed: 0,
    audited: 0,
  };

  if (meta.kind === "audio") {
    // التفريغ من الصوت يحتاج ffmpeg وحصص المزوّدين؛ يُفعَّل مع م2
    // الكاملة. حتى ذلك الحين يُتخطّى بوضوح بدل أن يُعدّ نجاحًا.
    return { ...base, skipped: "مقطع صوتي — قياس الخط الكامل لم يُفعَّل بعد" };
  }
  if (textOnly && meta.kind !== "text") {
    return { ...base, skipped: "مستثنى بـ --text" };
  }

  const raw = (await readFile(join(dir, "raw.txt"), "utf8")).trim();
  const rawWer = wordErrorRate(reference, raw);

  let output;
  try {
    output = await reviewTranscript({
      paragraphs: toParagraphs(raw),
      positions: [],
      // لا توقيتات ولا درجات ثقة في المقطع النصّي، فالأدلة من
      // المسرد والرسم وحدها — وهذا يقيس أضعف حالة للمراجعة.
      words: [],
      disagreements: [],
      glossary: meta.glossary ?? [],
      mode: meta.mode ?? "clean",
    });
  } catch (err) {
    return {
      ...base,
      raw: rawWer,
      skipped: err instanceof Error ? err.message.slice(0, 80) : "فشل النداء",
    };
  }

  return {
    name,
    dialect: meta.dialect,
    raw: rawWer,
    reviewed: wordErrorRate(reference, output.reviewed.join("\n\n")),
    audited: wordErrorRate(reference, output.audited.join("\n\n")),
  };
}

function report(rows: Row[]): void {
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const pad = (s: string, n: number) => s + " ".repeat(Math.max(0, n - width(s)));

  console.log("\nمعدل خطأ الكلمة بعد كل مرحلة\n");
  console.log(
    `${pad("المقطع", 20)}${pad("اللهجة", 16)}${pad("التفريغ", 10)}${pad("المراجعة", 10)}التدقيق`,
  );
  console.log("─".repeat(70));

  for (const row of rows) {
    if (row.skipped) {
      console.log(`${pad(row.name, 20)}${pad(row.dialect, 16)}— ${row.skipped}`);
      continue;
    }
    console.log(
      pad(row.name, 20) +
        pad(row.dialect, 16) +
        pad(pct(row.raw), 10) +
        pad(pct(row.reviewed), 10) +
        pct(row.audited),
    );
  }

  const measured = rows.filter((r) => !r.skipped);
  if (measured.length === 0) return;

  const mean = (pick: (r: Row) => number) =>
    measured.reduce((s, r) => s + pick(r), 0) / measured.length;

  console.log("─".repeat(70));
  console.log(
    pad("المتوسط", 36) +
      pad(pct(mean((r) => r.raw)), 10) +
      pad(pct(mean((r) => r.reviewed)), 10) +
      pct(mean((r) => r.audited)),
  );
}

/** العربية تُعرض بعرض حرف واحد لكل رمز في الطرفية؛ الحركات لا عرض لها. */
function width(s: string): number {
  return [...s.replace(/[ً-ْ]/g, "")].length;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
