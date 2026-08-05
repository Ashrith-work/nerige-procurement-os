import { headers } from 'next/headers'
import { LoginForm } from './login-form'
import { getDictionary, localeFromAcceptLanguage } from '@/lib/i18n'

export const metadata = { title: 'Sign in · Nerige' }

export default async function LoginPage({
  searchParams,
}: {
  // Next.js 16: searchParams is async.
  searchParams: Promise<{ next?: string }>
}) {
  const { next } = await searchParams
  // Only same-origin paths survive, so a crafted ?next= cannot turn the sign-in
  // screen into an open redirect.
  const safeNext = next?.startsWith('/') && !next.startsWith('//') ? next : '/'

  // No session yet, so no profile language to read. The browser's own
  // preference is the best available guess and costs the weaver nothing.
  const t = getDictionary(localeFromAcceptLanguage((await headers()).get('accept-language')))

  return (
    <main className="flex min-h-dvh items-center justify-center bg-stone-50 px-4 py-10">
      <div className="w-full max-w-sm space-y-6">
        <header className="text-center">
          <h1 className="text-xl font-medium tracking-tight text-stone-900">{t.login.brand}</h1>
        </header>

        <div className="rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
          <LoginForm next={safeNext} t={t} />
        </div>

        <p className="text-center text-xs text-stone-400">{t.login.byInvitation}</p>
      </div>
    </main>
  )
}
