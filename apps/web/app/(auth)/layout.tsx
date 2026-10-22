import Link from "next/link";
import type { ReactNode } from "react";
import type { Metadata } from "next";

export const metadata: Metadata = { referrer: "no-referrer", robots: { index: false, follow: false } };

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-5 py-12">
      <section className="w-full max-w-sm rounded-2xl border bg-card p-6 sm:p-8" aria-label="Аккаунт">
        <Link href="/" className="mb-8 block text-center font-wordmark text-5xl">Instagram</Link>
        {children}
      </section>
    </main>
  );
}
