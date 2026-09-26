import type { Metadata } from "next";
import Link from "next/link";
import { SignOutButton } from "@/components/sign-out-button";
import { env } from "@/lib/env";
import { getCurrentUser } from "@/lib/session";
import "./globals.css";

export const metadata: Metadata = {
  title: "تفريغ",
  description: "تفريغ المقاطع الصوتية والمرئية العربية بثلاث مراحل مراجعة",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // الزائر في صفحتي الدخول والإعداد لا يرى روابط لا يصل إليها، ولا
  // زرّ «خروج» من جلسة لم تبدأ.
  const user = await getCurrentUser().catch(() => null);

  return (
    <html lang="ar" dir="rtl">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="font-sans min-h-dvh">
        <header className="border-b border-line bg-panel">
          <div className="mx-auto flex max-w-5xl items-center gap-6 px-4 py-4">
            <Link
              href="/"
              className="text-xl font-bold text-brand"
              aria-label="تفريغ — الصفحة الرئيسية"
            >
              تفريغ
            </Link>
            {user && (
              <>
                <nav className="flex flex-1 items-center gap-1 text-sm">
                  <NavLink href="/">المجلدات</NavLink>
                  <NavLink href="/jobs">المهام</NavLink>
                </nav>
                <SignOutButton />
              </>
            )}
          </div>
        </header>

        {env().DEMO_MODE && (
          <p className="bg-warn/15 px-4 py-2 text-center text-sm">
            وضع العرض التجريبي: التفريغ والمراجعة هنا محاكاة لا نماذج حقيقية.
          </p>
        )}

        <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
      </body>
    </html>
  );
}

function NavLink({ href, children }: { href: string; children: string }) {
  return (
    <Link
      href={href}
      // 44px حد أدنى لمساحة اللمس
      className="flex min-h-11 items-center rounded-lg px-3 text-ink-soft transition-colors hover:bg-brand-soft hover:text-ink"
    >
      {children}
    </Link>
  );
}
