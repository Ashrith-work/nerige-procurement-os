import Link from 'next/link'
import { Button } from '@/components/ui/primitives'
import { Logo } from '@/components/brand/logo'
import { getUserDictionary } from '@/lib/auth/session'

export const metadata = { title: 'Not authorised' }

export default async function NotAuthorisedPage() {
  const t = (await getUserDictionary()).auth

  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div className="max-w-sm space-y-3 text-center">
        <div className="flex justify-center pb-2">
          <Logo variant="wordmark" />
        </div>
        <h1 className="text-lg font-medium">{t.noAccess}</h1>
        <p className="text-sm text-stone-500">{t.noAccessHelp}</p>
        <Link href="/">
          <Button variant="secondary">{t.backToSignIn}</Button>
        </Link>
      </div>
    </main>
  )
}
