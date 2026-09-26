import type { TranscriptionProvider, TranscribeInput } from "@/lib/providers/types";
import type { TranscriptResult, Word } from "@/lib/transcript/types";
import { chance, demoScript } from "./script";

/**
 * محرّكا تفريغ محاكَيان لوضع العرض التجريبي.
 *
 * يقرآن النصّ المرجعي للمقطع ويُدخلان عليه أخطاءً من جنس أخطاء
 * المحرّكات الحقيقية — لكلٍّ نمطه، فيختلفان في مواضع ويتفقان في غيرها،
 * وهذا ما يُحرّك مخطط الاختلاف والمراجعة كما لو كانا حقيقيين.
 *
 * - «أ» يحاكي Whisper: يُسقط الهمزات، ويخلط التاء المربوطة بالهاء، ويخطئ
 *   في المفردات العامية وأسماء الأماكن، ويعطي درجة ثقة لكل كلمة.
 * - «ب» يحاكي Gemini: أدقّ في العامية والهمزات، لكنه يكتب الأعداد أرقامًا،
 *   ويُسقط كلمة أحيانًا، ولا يعطي درجات ثقة.
 */

/** أخطاء المحرّك «أ» في المفردات العامية وأسماء الأعلام. */
const ENGINE_A_MISHEARS: Record<string, string> = {
  "وش": "ويش",
  "هالحلقة": "هل الحلقة",
  "السواني": "السوان",
  "الصرام": "الصرم",
  "يلقف": "يلقط",
  "نكنزه": "نكنسه",
  "خمسطعش": "خمسة عشر",
  "القصيم": "القسيم",
  "بريدة": "بريده",
  "عبدالله": "عبد الله",
  "الخلاص": "الخلاس",
  "الصقعي": "السقعي",
  "العذق": "العدق",
  "الحراج": "الحرج",
  "مكاين": "مكائن",
};

/** أخطاء المحرّك «ب»: الأعداد أرقامًا، وبعض الأسماء. */
const ENGINE_B_RENDERS: Record<string, string> = {
  "ألف": "1000",
  "ثلاثمية": "300",
  "مية": "100",
  "خمسين": "50",
  "عشرين": "20",
  "ثمان": "8",
  "السواني": "السواقي",
  "العذق": "العذق",
  "الصرام": "الصرام",
  "نكنزه": "نكنزه",
};

function dropHamza(word: string): string {
  return word.replace(/^[أإ]/, "ا").replace(/^(ال|و|ب|ل|ف)[أإ]/, "$1ا");
}

function wordsInChunk(input: TranscribeInput): { word: Word; index: number }[] {
  const offset = input.offsetMs ?? 0;
  const end = offset + input.audioSeconds * 1000;
  const script = demoScript();
  const out: { word: Word; index: number }[] = [];

  script.forEach((w, index) => {
    const mid = (w.startMs + w.endMs) / 2;
    if (mid < offset || mid >= end) return;
    out.push({
      index,
      word: {
        text: w.text,
        startMs: w.startMs - offset,
        endMs: w.endMs - offset,
      },
    });
  });
  return out;
}

function result(
  engine: string,
  model: string,
  words: Word[],
  audioSeconds: number,
): TranscriptResult {
  const scored = words.filter((w) => w.confidence !== undefined);
  return {
    text: words.map((w) => w.text).join(" "),
    words,
    avgConfidence: scored.length
      ? scored.reduce((s, w) => s + w.confidence!, 0) / scored.length
      : undefined,
    engine,
    model,
    audioSeconds,
  };
}

/** تفريغ كلمة قد يتحوّل إلى كلمتين («عبد الله») — نوزّع توقيتها عليهما. */
function splitTimed(word: Word, text: string, confidence?: number): Word[] {
  const parts = text.split(" ");
  const step = (word.endMs - word.startMs) / parts.length;
  return parts.map((p, i) => ({
    text: p,
    startMs: Math.round(word.startMs + step * i),
    endMs: Math.round(word.startMs + step * (i + 1)),
    confidence,
  }));
}

export class DemoEngineA implements TranscriptionProvider {
  readonly name = "demo-a";
  readonly model = "محاكاة Whisper";
  readonly isRemote = false;

  isConfigured(): boolean {
    return true;
  }

  async transcribe(input: TranscribeInput): Promise<TranscriptResult> {
    const out: Word[] = [];

    for (const { word, index } of wordsInChunk(input)) {
      const bare = word.text.replace(/[،.؟!,]/g, "");
      const punct = word.text.slice(bare.length);
      const r = chance(`a:${index}`);

      let text = bare;
      let confidence = 0.88 + chance(`ac:${index}`) * 0.1;

      if (ENGINE_A_MISHEARS[bare] && r < 0.7) {
        // خطأ سماع: المحرّك نفسه غالبًا غير واثق منه — دليل للمراجعة
        text = ENGINE_A_MISHEARS[bare]!;
        confidence = 0.3 + chance(`al:${index}`) * 0.25;
      } else if (/^(ال|و|ب|ل|ف)?[أإ]/.test(bare) && r < 0.45) {
        // إسقاط الهمزة: خطأ رسم يقع فيه المحرّك وهو واثق
        text = dropHamza(bare);
      } else if (/ة$/.test(bare) && r < 0.25) {
        text = bare.replace(/ة$/, "ه");
      } else if (r > 0.985) {
        // خطأ عشوائي نادر بلا سبب ظاهر
        confidence = 0.4;
      }

      // Whisper يضع علامات ترقيم أحيانًا لا دائمًا
      if (punct && chance(`ap:${index}`) < 0.5) text += punct;
      out.push(...splitTimed(word, text, confidence));
    }

    return result(this.name, this.model, out, input.audioSeconds);
  }
}

export class DemoEngineB implements TranscriptionProvider {
  readonly name = "demo-b";
  readonly model = "محاكاة Gemini";
  readonly isRemote = false;

  isConfigured(): boolean {
    return true;
  }

  async transcribe(input: TranscribeInput): Promise<TranscriptResult> {
    const out: Word[] = [];

    for (const { word, index } of wordsInChunk(input)) {
      const r = chance(`b:${index}`);
      if (r > 0.975) continue; // يُسقط كلمة أحيانًا

      const bare = word.text.replace(/[،.؟!,]/g, "");
      const punct = word.text.slice(bare.length);
      let text = ENGINE_B_RENDERS[bare] ?? bare;
      if (text === bare && r < 0.04) text = dropHamza(bare);

      out.push({ ...word, text: text + punct });
    }

    return result(this.name, this.model, out, input.audioSeconds);
  }
}
