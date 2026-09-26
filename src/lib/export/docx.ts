import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from "docx";
import { clock } from "@/lib/format";
import { metaLines, type ExportMeta } from "./text";

/**
 * مستند Word.
 *
 * `bidirectional` على كل فقرة هو ما يجعل Word يعامل النصّ عربيًا حقًا:
 * بدونه تنقلب علامات الترقيم إلى آخر السطر وتُكسر الأرقام. الضبط على
 * مستوى المستند لا يكفي، فكل فقرة تحمله.
 */
export async function toDocx(text: string, meta: ExportMeta): Promise<Buffer> {
  const paragraphs = meta.timeline?.length
    ? meta.timeline
    : text
        .trim()
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .filter(Boolean)
        .map((body) => ({ body, speaker: null, startMs: null }));

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
                children: [
                  // التوقيت يدلّ القارئ على موضع الفقرة في التسجيل
                  ...(p.startMs != null
                    ? [new TextRun({ text: `${clock(p.startMs)}  `, size: 18, color: "888888" })]
                    : []),
                  ...(p.speaker ? [new TextRun({ text: `${p.speaker}: `, bold: true })] : []),
                  new TextRun({ text: p.body }),
                ],
              }),
          ),
        ],
      },
    ],
  });

  return Packer.toBuffer(doc);
}
