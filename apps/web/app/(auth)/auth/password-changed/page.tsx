import Link from "next/link";

export default function PasswordChangedPage() {
  return <div className="space-y-5">
    <h1 className="text-2xl font-semibold">Пароль изменён</h1>
    <p>Все прежние сессии этого аккаунта завершены. Войдите с новым паролем.</p>
    <Link href="/auth/login" className="text-ig-link underline">Войти в аккаунт</Link>
  </div>;
}
