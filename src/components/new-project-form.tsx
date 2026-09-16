"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  profileHint,
  profileLabel,
  transcriptionModeHint,
  transcriptionModeLabel,
} from "@/lib/labels";

export function NewProjectForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [mode, setMode] = useState("clean");
  const [profile, setProfile] = useState("free_cloud");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, transcriptionMode: mode, profile }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "تعذّر إنشاء المجلد. حاول مرة أخرى.");
      }
      const project = await res.json();
      router.push(`/projects/${project.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "حدث خطأ غير متوقع.");
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="min-h-11 rounded-lg bg-brand px-5 font-medium text-white transition-opacity hover:opacity-90"
      >
        مجلد جديد
      </button>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="w-full space-y-5 rounded-xl border border-line bg-panel p-5"
    >
      <div className="space-y-2">
        <label htmlFor="project-name" className="block font-medium">
          اسم المجلد
        </label>
        <input
          id="project-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={120}
          autoFocus
          placeholder="مثال: محاضرات الفصل الأول"
          className="min-h-11 w-full rounded-lg border border-line bg-surface px-4 outline-none focus:border-brand"
        />
      </div>

      <RadioGroup
        legend="نمط التفريغ"
        name="mode"
        value={mode}
        onChange={setMode}
        options={["clean", "verbatim", "formal"]}
        labels={transcriptionModeLabel}
        hints={transcriptionModeHint}
      />

      <RadioGroup
        legend="طريقة المعالجة"
        name="profile"
        value={profile}
        onChange={setProfile}
        options={["free_cloud", "local_only"]}
        labels={profileLabel}
        hints={profileHint}
      />

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy || !name.trim()}
          className="min-h-11 rounded-lg bg-brand px-5 font-medium text-white disabled:opacity-50"
        >
          {busy ? "جارٍ الإنشاء…" : "إنشاء"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="min-h-11 rounded-lg px-5 text-ink-soft hover:bg-brand-soft"
        >
          إلغاء
        </button>
      </div>
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
              value === opt
                ? "border-brand bg-brand-soft"
                : "border-line hover:border-brand"
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
