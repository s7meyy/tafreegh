import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from "docx";
import { formatDate, formatDuration } from "@/lib/format";
import { transcriptionModeLabel } from "@/lib/labels";
import type { ExportMeta } from "./text";

/**
 * مستند Word.
 *
 * `bidirectional` على كل فقرة هو ما يجعل Word يعامل النصّ عربيًا حقًا:
 * بدونه تنقلب علامات الترقيم إلى آخر السطر وتُكسر الأرقام. الضبط على
 * مستوى المستند لا يكفي، فكل فقرة تحمله.
 */
export async function toDocx(text: string, meta: ExportMeta): Promise<Buffer> {
  const paragraphs = text
    .trim()
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: "Arial", size: 24, rightToLeft: true },
          paragraph: { spacing: { line: 380, after: 200 } },
        },
      },
    },
    sections: [
      {
        properties: {},
        children: [
          new Paragraph({
            text: meta.title,
            heading: HeadingLevel.HEADING_1,
            bidirectional: true,
            alignment: AlignmentType.START,
          }),
          ...metaLines(meta).map(
            (line) =>
              new Paragraph({
                bidirectional: true,
                alignment: AlignmentType.START,
                children: [new TextRun({ text: line, size: 20, color: "666666" })],
              }),
          ),
          new Paragraph({ text: "", bidirectional: true }),
          ...paragraphs.map(
            (p) =>
              new Paragraph({
                bidirectional: true,
                alignment: AlignmentType.JUSTIFIED,
                children: [new TextRun({ text: p })],
              }),
          ),
        ],
      },
    ],
  });

  return Packer.toBuffer(doc);
}

function metaLines(meta: ExportMeta): string[] {
  const lines = [
    `المجلد: ${meta.project}`,
    `نمط التفريغ: ${transcriptionModeLabel[meta.mode] ?? meta.mode}`,
  ];
  if (meta.durationSec) lines.push(`المدة: ${formatDuration(meta.durationSec)}`);
  if (meta.approvedAt) lines.push(`اعتُمد في: ${formatDate(meta.approvedAt)}`);
  return lines;
}
