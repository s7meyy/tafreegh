"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function AuthForm({ mode }: { mode: "login" | "setup" }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password, name, action: mode }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "تعذّر المتابعة.");
      }
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "حدث خطأ غير متوقع.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mx-auto max-w-sm space-y-5">
      <div>
        <h1 className="text-2xl font-bold">
          {mode === "setup" ? "إنشاء حسابك" : "تسجيل الدخول"}
        </h1>
        <p className="mt-1 text-sm text-ink-soft">
          {mode === "setup"
            ? "هذا أول حساب في الموقع، وبإنشائه يُغلق باب الإنشاء."
            : "أدخل بريدك وكلمة مرورك."}
        </p>
      </div>

      {mode === "setup" && (
        <Field
          id="name"
          label="الاسم"
          value={name}
          onChange={setName}
          autoComplete="name"
          required={false}
        />
      )}

      <Field
        id="email"
        label="البريد"
        type="email"
        value={email}
        onChange={setEmail}
        autoComplete="email"
      />

      <div className="space-y-2">
        <Field
          id="password"
          label="كلمة المرور"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete={mode === "setup" ? "new-password" : "current-password"}
        />
        {mode === "setup" && (
          <p className="text-sm text-ink-soft">12 حرفًا فأكثر.</p>
        )}
      </div>

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy || !email || !password}
        className="min-h-11 w-full rounded-lg bg-brand px-5 font-medium text-white disabled:opacity-50"
      >
        {busy ? "لحظة…" : mode === "setup" ? "إنشاء الحساب" : "دخول"}
      </button>
    </form>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  type = "text",
  autoComplete,
  required = true,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  autoComplete?: string;
  required?: boolean;
}) {
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block font-medium">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        autoComplete={autoComplete}
        // البريد وكلمة المرور لاتينيان دائمًا؛ إبقاؤهما يمينًا يربك.
        dir={type === "email" || type === "password" ? "ltr" : "rtl"}
        className="min-h-11 w-full rounded-lg border border-line bg-panel px-4 outline-none focus:border-brand"
      />
    </div>
  );
}
