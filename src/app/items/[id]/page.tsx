import Link from "next/link";
import { notFound } from "next/navigation";
import { bestText, loadItem, stageTexts } from "@/lib/items";
import { clock, formatDate, formatDuration } from "@/lib/format";
import {
  editReasonLabel,
  IN_PROGRESS_STATUSES,
  itemStatusLabel,
  itemStatusTone,
  transcriptionModeLabel,
} from "@/lib/labels";
import { requireUser } from "@/lib/session";
import { ApprovalEditor } from "@/components/approval-editor";
import { AudioProvider, PlayButton } from "@/components/audio-spots";
import { AutoRefresh } from "@/components/auto-refresh";
import { ItemActions } from "@/components/item-actions";
import { TitleSuggestion } from "@/components/title-suggestion";
import { ExportButtons } from "@/components/export-buttons";
import { UnresolvedSpans } from "@/components/unresolved-spans";
import { hasChanges, wordDiff, type DiffSegment } from "@/lib/transcript/word-diff";
import { speakersIn, splitParagraphs } from "@/lib/transcript/speakers";

export const dynamic = "force-dynamic";

export default async function ItemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();

  const loaded = await loadItem(id, user.id);
  if (!loaded) notFound();

  const { item, project, edits } = loaded;
  const stages = stageTexts(loaded.stages);
  const text = bestText(loaded.stages);
  const approved = Boolean(item.approvedAt);
  // الصوت متاح للاستماع ما دام المقطع لم يُعتمد ولم تُحذف وسائطه
  const audio = !approved && !item.mediaDeletedAt && Boolean(item.durationSec);
  const spots = approved ? [] : loaded.unresolved;

  return (
    <div className="space-y-8">
      <AutoRefresh active={IN_PROGRESS_STATUSES.has(item.status)} />
      <header>
        <Link
          href={`/projects/${project.id}`}
          className="text-sm text-ink-soft hover:text-brand"
        >
          ← {project.name}
        </Link>
        <h1 className="mt-2 text-2xl font-bold">{item.title}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 text-sm text-ink-soft">
          <span className={itemStatusTone[item.status] ?? ""}>
            {itemStatusLabel[item.status]}
          </span>
          <span>·</span>
          <span>{formatDuration(item.durationSec)}</span>
          <span>·</span>
          <span>نمط {transcriptionModeLabel[project.transcriptionMode]}</span>
          {item.mediaDeletedAt && (
            <>
              <span>·</span>
              <span>الوسائط محذوفة — النصّ وحده محفوظ</span>
            </>
          )}
        </p>
        {item.suggestedTitle && item.suggestedTitle !== item.title && (
          <TitleSuggestion itemId={item.id} suggestion={item.suggestedTitle} />
        )}
        <div className="mt-4">
          <ItemActions itemId={item.id} title={item.title} failed={item.status === "failed"} />
        </div>
      </header>

      {IN_PROGRESS_STATUSES.has(item.status) && <StageSteps status={item.status} />}

      {item.errorMessage && (
        <p role="alert" className="rounded-xl border border-danger/40 bg-panel p-4 text-danger">
          {item.errorMessage}
        </p>
      )}

      {!text ? (
        <p className="rounded-xl border border-dashed border-line bg-panel p-10 text-center text-ink-soft">
          لا نصّ بعد — المقطع ما زال في مرحلة {itemStatusLabel[item.status]}.
        </p>
      ) : (
        <AudioProvider itemId={item.id} enabled={audio}>
          <div className="space-y-8">
            <Summary
              text={text}
              applied={edits.filter((e) => e.verdict === "accepted").length}
              spots={spots.length}
            />

            {!approved && <UnresolvedSpans itemId={item.id} spans={spots} />}

            <ApprovalEditor
              itemId={item.id}
              initialText={text}
              approved={approved}
              approvedAt={item.approvedAt ? formatDate(item.approvedAt) : null}
              spotIds={spots.map((s, i) => s.id ?? i + 1)}
            />

            <ExportButtons itemId={item.id} approved={approved} />

            <StageComparison stages={stages} />

            {edits.length > 0 && <EditsTable edits={edits} />}
          </div>
        </AudioProvider>
      )}
    </div>
  );
}

function StageComparison({
  stages,
}: {
  stages: ReturnType<typeof stageTexts>;
}) {
  const shown = [
    { key: "transcribe", label: "التفريغ الآلي", row: stages.transcribe },
    { key: "review", label: "بعد المراجعة", row: stages.review },
    { key: "audit", label: "بعد التدقيق", row: stages.audit },
    { key: "final", label: "نسختك المعتمدة", row: stages.final },
  ].filter((s) => s.row);

  if (shown.length < 2) return null;

  return (
    <details className="rounded-xl border border-line bg-panel">
      <summary className="flex min-h-11 cursor-pointer items-center px-5 font-medium">
        مقارنة المراحل
      </summary>
      <div className="space-y-5 border-t border-line p-5">
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-soft">
          <span>كل مرحلة معروضة مقابل التي قبلها:</span>
          <span>
            <del className="rounded bg-danger/15 px-1 text-danger">محذوف</del>
          </span>
          <span>
            <ins className="rounded bg-ok/15 px-1 text-ok no-underline">مضاف</ins>
          </span>
        </p>

        {shown.map((stage, index) => {
          const previous = index > 0 ? shown[index - 1]!.row!.text : null;
          const segments = previous ? wordDiff(previous, stage.row!.text) : null;

          return (
            <section key={stage.key}>
              <h3 className="mb-2 text-sm font-semibold text-ink-soft">
                {stage.label}
                {stage.row!.avgConfidence != null &&
                  ` · متوسط الثقة ${(stage.row!.avgConfidence * 100).toFixed(0)}%`}
                {segments && !hasChanges(segments) && " · بلا تغيير"}
              </h3>
              <div className="rounded-lg bg-surface p-4 text-sm leading-loose">
                {segments ? (
                  <DiffView segments={segments} />
                ) : (
                  <p className="whitespace-pre-wrap">{stage.row!.text}</p>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </details>
  );
}

/** النصّ بفروقه: المحذوف مشطوب بالأحمر، والمضاف بخلفية خضراء. */
function DiffView({ segments }: { segments: DiffSegment[] }) {
  return (
    <p>
      {segments.map((seg, i) => {
        if (seg.kind === "break") return <span key={i} className="block h-4" />;
        const text = `${seg.text} `;
        if (seg.kind === "removed") {
          return (
            <del key={i} className="rounded bg-danger/15 px-0.5 text-danger">
              {text}
            </del>
          );
        }
        if (seg.kind === "added") {
          return (
            <ins key={i} className="rounded bg-ok/15 px-0.5 text-ok no-underline">
              {text}
            </ins>
          );
        }
        return <span key={i}>{text}</span>;
      })}
    </p>
  );
}

const STEPS = [
  { key: "fetching", label: "الجلب" },
  { key: "preparing", label: "التحضير" },
  { key: "transcribing", label: "التفريغ" },
  { key: "reviewing_1", label: "المراجعة" },
  { key: "reviewing_2", label: "التدقيق" },
  { key: "awaiting_approval", label: "اعتمادك" },
] as const;

/** أين وصل المقطع من مراحله — بدل كلمة حالة وحدها لا تقول كم بقي. */
function StageSteps({ status }: { status: string }) {
  const current = status === "queued" ? -1 : STEPS.findIndex((s) => s.key === status);
  return (
    <ol className="flex flex-wrap gap-2 text-sm" aria-label="مراحل المعالجة">
      {STEPS.map((step, i) => {
        const state = i < current ? "done" : i === current ? "now" : "next";
        return (
          <li
            key={step.key}
            aria-current={state === "now" ? "step" : undefined}
            className={`flex min-h-9 items-center gap-2 rounded-full px-3 ${
              state === "now"
                ? "bg-brand text-white"
                : state === "done"
                  ? "bg-brand-soft text-ink"
                  : "border border-line text-ink-soft"
            }`}
          >
            <span aria-hidden>{state === "done" ? "✓" : i + 1}</span>
            {step.label}
          </li>
        );
      })}
    </ol>
  );
}

/** خلاصة المقطع في سطر: ما يعرفه القارئ قبل أن يقرأ. */
function Summary({ text, applied, spots }: { text: string; applied: number; spots: number }) {
  const paragraphs = splitParagraphs(text);
  const speakers = [...speakersIn(text)];
  const words = text.split(/\s+/).filter(Boolean).length;
  const facts = [
    `${words.toLocaleString("ar")} كلمة`,
    `${paragraphs.length.toLocaleString("ar")} فقرة`,
    speakers.length > 0 ? `المتحدثون: ${speakers.join("، ")}` : null,
    applied > 0 ? `${applied.toLocaleString("ar")} تصحيحًا آليًا` : null,
    spots > 0 ? `${spots.toLocaleString("ar")} موضعًا للمراجعة` : null,
  ].filter(Boolean);

  return (
    <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-ink-soft">
      {facts.map((f, i) => (
        <span key={i}>
          {i > 0 && <span aria-hidden className="me-3">·</span>}
          {f}
        </span>
      ))}
    </p>
  );
}

function verdictLabel(verdict: string, note: string | null): string {
  if (verdict === "accepted") return note ?? "أقرّه التدقيق";
  if (note?.startsWith("الحارس")) return `رفضه الحارس — ${note.replace(/^الحارس:\s*/, "")}`;
  return "رفضه التدقيق";
}

function EditsTable({
  edits,
}: {
  edits: {
    id: string;
    paragraph: number;
    before: string;
    after: string;
    reason: string;
    verdict: string;
    verdictNote: string | null;
    startMs: number | null;
    endMs: number | null;
  }[];
}) {
  return (
    <details className="rounded-xl border border-line bg-panel">
      <summary className="flex min-h-11 cursor-pointer items-center px-5 font-medium">
        التعديلات وأسبابها ({edits.length})
      </summary>
      <ul className="divide-y divide-line border-t border-line">
        {edits.map((edit) => (
          <li key={edit.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-4 text-sm">
            <span className="text-ink-soft">
              فقرة {edit.paragraph}
              {edit.startMs != null && <span className="ltr-inline ms-2">{clock(edit.startMs)}</span>}
            </span>
            <span className="line-through decoration-danger/60">{edit.before}</span>
            <span aria-hidden>←</span>
            <span className="font-medium">{edit.after || "(حُذف)"}</span>
            <span className="rounded-full bg-brand-soft px-2 py-0.5 text-xs">
              {editReasonLabel[edit.reason] ?? edit.reason}
            </span>
            <span
              className={`text-xs ${edit.verdict === "accepted" ? "text-ok" : "text-ink-soft"}`}
            >
              {verdictLabel(edit.verdict, edit.verdictNote)}
            </span>
            {edit.reason !== "glossary" && (
              <span className="ms-auto">
                <PlayButton spot={`edit-${edit.id}`} startMs={edit.startMs} endMs={edit.endMs} />
              </span>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
