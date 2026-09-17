"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    await fetch("/api/auth", { method: "DELETE" });
    router.push("/login");
    router.refresh();
  }

  return (
    <button
      onClick={signOut}
      disabled={busy}
      className="min-h-11 rounded-lg px-3 text-sm text-ink-soft hover:bg-brand-soft hover:text-ink disabled:opacity-50"
    >
      خروج
    </button>
  );
}
