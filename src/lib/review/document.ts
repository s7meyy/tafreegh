import { mapThroughReplacements, applyGlossaryVariants, type GlossaryEntry } from "./glossary";
import { remapPositions } from "./evidence";
import { layoutParagraphs, type Layout } from "@/lib/transcript/layout";
import { speakerNames, withSpeaker } from "@/lib/transcript/speakers";
import type { Word } from "@/lib/transcript/types";

/**
 * نصّ المراجعة: فقرات مبنية من الكلمات، مصحَّحة بالمسرد، بمواضع
 * كلماتها بعد التصحيح. المصدر الواحد لما يُعرض ولما يُراجَع — فلا
 * يختلف نصّ «التفريغ الآلي» في المقارنة عن النصّ الذي بدأت منه المراجعة.
 */
export function prepareDocument(words: readonly Word[], glossary: readonly GlossaryEntry[]) {
  const layout = layoutParagraphs(words);
  const pass = applyGlossaryVariants(
    layout.paragraphs.map((p) => p.text),
    glossary,
  );
  const positions = remapPositions(layout.positions, (para, start, end) =>
    mapThroughReplacements(pass.replacements[para - 1] ?? [], start, end),
  );
  return { layout, paragraphs: pass.paragraphs, positions, glossaryEdits: pass.edits };
}

/**
 * جمع الفقرات نصًّا واحدًا بأسماء المتحدثين.
 * الأسماء لا تُكتب إلا حين يتعدد المتحدثون: متحدث واحد لا يحتاج اسمًا
 * على كل فقرة.
 */
export function composeText(
  paragraphs: readonly string[],
  layout: Layout,
  names: readonly string[] = [],
): string {
  const labels = layout.paragraphs.map((p) => p.speaker);
  const map = speakerNames(labels, names);
  const many = map.size >= 2;
  return paragraphs
    .map((p, i) => (many ? withSpeaker(p, map.get(labels[i] ?? "") ?? null) : p))
    .join("\n\n");
}
