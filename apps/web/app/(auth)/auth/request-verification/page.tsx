import Link from "next/link";
export default function Page() { return <div className="space-y-4"><h1 className="text-2xl font-semibold">Подтверждение email больше не требуется</h1><Link href="/" className="text-ig-link underline">Перейти к ленте</Link><Link href="/auth/login" className="block text-ig-link underline">Войти</Link></div>; }
