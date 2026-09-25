import Link from "next/link";
import { notFound } from "next/navigation";
import { bestText, loadItem, stageTexts } from "@/lib/items";
import { formatDate, formatDuration } from "@/lib/format";
import {
  editReasonLabel,
  itemStatusLabel,
  itemStatusTone,
  transcriptionModeLabel,
} from "@/lib/labels";
import { requireUser } from "@/lib/session";
import { ApprovalEditor } from "@/components/approval-editor";
import { ExportButtons } from "@/components/export-buttons";
import { UnresolvedSpans } from "@/components/unresolved-spans";

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

  return (
    <div className="space-y-8">
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
      </header>

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
        <>
          {!approved && <UnresolvedSpans spans={loaded.unresolved} />}

          <ApprovalEditor
            itemId={item.id}
            initialText={text}
            approved={approved}
            approvedAt={item.approvedAt ? formatDate(item.approvedAt) : null}
          />

          <ExportButtons itemId={item.id} />

          <StageComparison stages={stages} />

          {edits.length > 0 && <EditsTable edits={edits} />}
        </>
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
        {shown.map((stage) => (
          <section key={stage.key}>
            <h3 className="mb-2 text-sm font-semibold text-ink-soft">
              {stage.label}
              {stage.row!.avgConfidence != null &&
                ` · متوسط الثقة ${(stage.row!.avgConfidence * 100).toFixed(0)}%`}
            </h3>
            <p className="whitespace-pre-wrap rounded-lg bg-surface p-4 text-sm">
              {stage.row!.text}
            </p>
          </section>
        ))}
      </div>
    </details>
  );
}

function EditsTable({ edits }: { edits: { id: string; paragraph: number; before: string; after: string; reason: string; verdict: string }[] }) {
  return (
    <details className="rounded-xl border border-line bg-panel">
      <summary className="flex min-h-11 cursor-pointer items-center px-5 font-medium">
        التعديلات وأسبابها ({edits.length})
      </summary>
      <ul className="divide-y divide-line border-t border-line">
        {edits.map((edit) => (
          <li key={edit.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 p-4 text-sm">
            <span className="text-ink-soft">فقرة {edit.paragraph}</span>
            <span className="line-through decoration-danger/60">{edit.before}</span>
            <span aria-hidden>←</span>
            <span className="font-medium">{edit.after || "(حُذف)"}</span>
            <span className="rounded-full bg-brand-soft px-2 py-0.5 text-xs">
              {editReasonLabel[edit.reason] ?? edit.reason}
            </span>
            <span
              className={`text-xs ${edit.verdict === "accepted" ? "text-ok" : "text-ink-soft"}`}
            >
              {edit.verdict === "accepted" ? "أقرّه التدقيق" : "رفضه التدقيق"}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
