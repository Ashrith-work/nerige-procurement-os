import Link from 'next/link'
import { headers } from 'next/headers'
import { LoginForm } from './login-form'
import { getDictionary, localeFromAcceptLanguage } from '@/lib/i18n'
import { isSupabaseConfigured, safeNext } from '@/lib/auth/guards'
import { Alert } from '@/components/ui/primitives'
import { Logo } from '@/components/brand/logo'

export const metadata = { title: 'Sign in' }

export default async function LoginPage({
  searchParams,
}: {
  // Next.js 16: searchParams is async.
  searchParams: Promise<{ next?: string }>
}) {
  const { next } = await searchParams
  // Only same-origin paths survive, so a crafted ?next= cannot turn the sign-in
  // screen into an open redirect.
  // The same check the sign-in action applies — see safeNext(): a backslash
  // after the leading slash is read as a protocol-relative URL by the browser.
  const nextPath = safeNext(next)

  // No session yet, so no profile language to read. The browser's own
  // preference is the best available guess and costs the weaver nothing.
  const t = getDictionary(localeFromAcceptLanguage((await headers()).get('accept-language')))

  return (
    <main className="flex min-h-dvh items-center justify-center bg-stone-50 px-4 py-10">
      <div className="w-full max-w-sm space-y-6">
        {/* The mark, at the one size on these screens where the script is
            comfortably readable rather than merely present. It is the only
            naming of the business on this page, so its alt text *is* the
            heading — no second sr-only copy of the name beside it. */}
        <header className="flex justify-center">
          <h1>
            <Logo variant="wordmark" priority />
          </h1>
        </header>

        {!isSupabaseConfigured() && (
          <Alert tone="error">
            This deployment has no Supabase project behind it yet, so nobody can sign in. Set
            NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY and redeploy.
          </Alert>
        )}

        <div className="rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
          <LoginForm next={nextPath} t={t} />
        </div>

        <p className="text-center text-xs text-stone-400">{t.login.byInvitation}</p>

        {/*
          * Deliberately quiet, and below the invitation notice rather than
          * beside the button. Almost everyone who reaches this screen already
          * has a login; the ones who do not are a handful of new weavers, and
          * a prominent signup link would invite the rest to wonder whether
          * they were supposed to use it.
          */}
        <p className="text-center text-xs text-stone-400">
          No account yet?{' '}
          <Link href="/signup" className="underline">
            Request one
          </Link>
        </p>
      </div>
    </main>
  )
}
