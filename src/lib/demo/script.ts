import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { env } from "@/lib/env";

/**
 * النصّ المرجعي لوضع العرض التجريبي — كل كلمة بتوقيتها ومتحدثها.
 * يُولَّد مع المقطع بـ `scripts/demo/make-audio.py`.
 */

export interface ScriptWord {
  text: string;
  startMs: number;
  endMs: number;
  speaker: string;
  turn: number;
}

let cached: ScriptWord[] | null = null;

export function demoScript(): ScriptWord[] {
  if (!cached) {
    const path = resolve(env().DEMO_SCRIPT);
    const data = JSON.parse(readFileSync(path, "utf8")) as { words: ScriptWord[] };
    cached = data.words;
  }
  return cached;
}

/** عشوائية حتمية: القيمة نفسها للمدخل نفسه في كل تشغيل. */
export function chance(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}
