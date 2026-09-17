"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  profileHint,
  profileLabel,
  transcriptionModeHint,
  transcriptionModeLabel,
} from "@/lib/labels";

interface Term {
  term: string;
  variants: string[];
}

export interface SettingsValues {
  name: string;
  transcriptionMode: string;
  profile: string;
  glossary: Term[];
}

/**
 * إعدادات المجلد.
 *
 * المسرد هنا ليس زينة: يُمرَّر تلقينًا لمحرّك التفريغ فيرفع دقة أسماء
 * الأعلام، وهو أحد أدلة المراجعة الثلاثة (§2.1). كتابة أسماء المتحدثين
 * ومصطلحات الموضوع قبل الرفع أنفع من تصحيحها بعده.
 */
export function ProjectSettings({
  projectId,
  initial,
}: {
  projectId: string;
  initial: SettingsValues;
}) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: values.name,
          transcriptionMode: values.transcriptionMode,
          profile: values.profile,
          // الصفوف الفارغة تُسقط: المستخدم يترك سطرًا فارغًا أثناء الكتابة.
          glossary: values.glossary.filter((t) => t.term.trim()),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "تعذّر الحفظ.");
      }
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "حدث خطأ غير متوقع.");
    } finally {
      setBusy(false);
    }
  }

  function updateTerm(index: number, patch: Partial<Term>) {
    setValues((prev) => ({
      ...prev,
      glossary: prev.glossary.map((t, i) => (i === index ? { ...t, ...patch } : t)),
    }));
  }

  return (
    <form onSubmit={save} className="space-y-8">
      <div className="space-y-2">
        <label htmlFor="name" className="block font-medium">
          اسم المجلد
        </label>
        <input
          id="name"
          value={values.name}
          onChange={(e) => setValues({ ...values, name: e.target.value })}
          required
          maxLength={120}
          className="min-h-11 w-full max-w-md rounded-lg border border-line bg-panel px-4 outline-none focus:border-brand"
        />
      </div>

      <RadioGroup
        legend="نمط التفريغ"
        name="mode"
        value={values.transcriptionMode}
        onChange={(v) => setValues({ ...values, transcriptionMode: v })}
        options={["clean", "verbatim", "formal"]}
        labels={transcriptionModeLabel}
        hints={transcriptionModeHint}
      />

      <RadioGroup
        legend="طريقة المعالجة"
        name="profile"
        value={values.profile}
        onChange={(v) => setValues({ ...values, profile: v })}
        options={["free_cloud", "local_only"]}
        labels={profileLabel}
        hints={profileHint}
      />

      <fieldset className="space-y-3">
        <legend className="font-medium">مسرد المشروع</legend>
        <p className="text-sm text-ink-soft">
          أسماء الأعلام والمصطلحات التي ترد في المقاطع، بالرسم الذي تريده.
          تُمرَّر لمحرّك التفريغ فيتعرّف عليها، وتُستعمل دليلًا في المراجعة.
        </p>

        <ul className="space-y-2">
          {values.glossary.map((term, i) => (
            <li key={i} className="flex flex-wrap gap-2">
              <input
                value={term.term}
                onChange={(e) => updateTerm(i, { term: e.target.value })}
                placeholder="المصطلح"
                aria-label={`المصطلح ${i + 1}`}
                className="min-h-11 min-w-48 flex-1 rounded-lg border border-line bg-panel px-4 outline-none focus:border-brand"
              />
              <input
                value={term.variants.join("، ")}
                onChange={(e) =>
                  updateTerm(i, {
                    variants: e.target.value
                      .split(/[،,]/)
                      .map((v) => v.trim())
                      .filter(Boolean),
                  })
                }
                placeholder="أشكال خاطئة شائعة، بينها فاصلة"
                aria-label={`أشكال ${i + 1}`}
                className="min-h-11 min-w-48 flex-1 rounded-lg border border-line bg-panel px-4 outline-none focus:border-brand"
              />
              <button
                type="button"
                onClick={() =>
                  setValues({
                    ...values,
                    glossary: values.glossary.filter((_, j) => j !== i),
                  })
                }
                aria-label={`حذف ${term.term || `المصطلح ${i + 1}`}`}
                className="min-h-11 rounded-lg px-4 text-ink-soft hover:bg-danger/10 hover:text-danger"
              >
                حذف
              </button>
            </li>
          ))}
        </ul>

        <button
          type="button"
          onClick={() =>
            setValues({
              ...values,
              glossary: [...values.glossary, { term: "", variants: [] }],
            })
          }
          className="min-h-11 rounded-lg border border-line px-5 hover:border-brand"
        >
          إضافة مصطلح
        </button>
      </fieldset>

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {saved && <p className="text-sm text-ok">حُفظ.</p>}

      <button
        type="submit"
        disabled={busy}
        className="min-h-11 rounded-lg bg-brand px-5 font-medium text-white disabled:opacity-50"
      >
        {busy ? "جارٍ الحفظ…" : "حفظ"}
      </button>
    </form>
  );
}

function RadioGroup({
  legend,
  name,
  value,
  onChange,
  options,
  labels,
  hints,
}: {
  legend: string;
  name: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  labels: Record<string, string>;
  hints: Record<string, string>;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="mb-2 font-medium">{legend}</legend>
      <div className="space-y-2">
        {options.map((opt) => (
          <label
            key={opt}
            className={`flex min-h-11 cursor-pointer gap-3 rounded-lg border p-3 transition-colors ${
              value === opt ? "border-brand bg-brand-soft" : "border-line hover:border-brand"
            }`}
          >
            <input
              type="radio"
              name={name}
              value={opt}
              checked={value === opt}
              onChange={() => onChange(opt)}
              className="mt-1.5 shrink-0 accent-brand"
            />
            <span>
              <span className="block font-medium">{labels[opt]}</span>
              <span className="block text-sm text-ink-soft">{hints[opt]}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
