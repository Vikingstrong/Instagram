import Link from "next/link";
import type { ReactNode } from "react";
import type { Metadata } from "next";
import { AuthArtwork, AuthBrand } from "@/features/auth/auth-design";

export const metadata: Metadata = { referrer: "no-referrer", robots: { index: false, follow: false } };

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    // The auth artwork is designed dark, so it keeps the dark palette in both themes.
    <main className="auth-layout dark">
      {/* Page corners glow in the Instagram logo colours, under both columns. */}
      <span aria-hidden="true" className="auth-page-glow auth-page-glow-tl" />
      <span aria-hidden="true" className="auth-page-glow auth-page-glow-tr" />
      <span aria-hidden="true" className="auth-page-glow auth-page-glow-bl" />
      <span aria-hidden="true" className="auth-page-glow auth-page-glow-br" />
      <div className="auth-story">
        <Link href="/auth/login" className="auth-brand-link"><AuthBrand /></Link>
        <div className="auth-story-content">
          <p className="auth-eyebrow">Люди. Места. Ваши истории.</p>
          <h2>Всё, что сближает.<br /><span>В одном моменте.</span></h2>
          <AuthArtwork />
          <p className="auth-story-footnote">Делитесь своим. Находите близкое.</p>
        </div>
      </div>
      <div className="auth-panel">
        <Link href="/auth/login" className="auth-mobile-brand"><AuthBrand /></Link>
        <section className="auth-form-container" aria-label="Аккаунт">{children}</section>
        <footer className="auth-footer"><span>© 2026 Instagram Clone</span><span>Русский</span></footer>
      </div>
    </main>
  );
}
