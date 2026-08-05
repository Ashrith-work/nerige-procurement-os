import Link from 'next/link'
import { headers } from 'next/headers'
import { Button } from '@/components/ui/primitives'
import { getDictionary, localeFromAcceptLanguage } from '@/lib/i18n'
import { signOut } from '@/app/(app)/actions'

export const metadata = { title: 'Sign-in problem' }

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>
}) {
  const { reason } = await searchParams
  const t = getDictionary(localeFromAcceptLanguage((await headers()).get('accept-language'))).auth

  const reasons: Record<string, string> = {
    invalid_link: t.linkExpired,
    missing_code: t.linkIncomplete,
    not_provisioned: t.notProvisioned,
    provider_refused: t.providerRefused,
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div className="max-w-sm space-y-3 text-center">
        <h1 className="text-lg font-medium">{t.cannotSignIn}</h1>
        <p className="text-sm text-stone-500">{reasons[reason ?? ''] ?? t.somethingWrong}</p>

        {/* Signing out matters here rather than merely linking away: the token
            is what causes the bounce between /login and /, so it has to go. */}
        {reason === 'not_provisioned' ? (
          <form action={signOut}>
            <Button type="submit">{t.backToSignIn}</Button>
          </form>
        ) : (
          <Link href="/login">
            <Button>{t.backToSignIn}</Button>
          </Link>
        )}
      </div>
    </main>
  )
}
