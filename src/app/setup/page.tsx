import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { hasAnyUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  // الباب يُغلق بعد أول حساب — الحارس هنا وفي مسار API معًا.
  if (await hasAnyUser()) redirect("/login");

  return <AuthForm mode="setup" />;
}
