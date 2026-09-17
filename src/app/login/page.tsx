import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { getCurrentUser, hasAnyUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/");
  if (!(await hasAnyUser())) redirect("/setup");

  return <AuthForm mode="login" />;
}
