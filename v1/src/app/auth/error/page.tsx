import Link from 'next/link'
import { Button } from '@/components/ui/primitives'

export const metadata = { title: 'Sign-in problem' }

const REASONS: Record<string, string> = {
  invalid_link: 'That sign-in link has expired or has already been used.',
  missing_code: 'That link is incomplete. Please request a new one.',
}

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>
}) {
  const { reason } = await searchParams

  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div className="max-w-sm space-y-3 text-center">
        <h1 className="text-lg font-semibold">Could not sign you in</h1>
        <p className="text-sm text-stone-500">
          {REASONS[reason ?? ''] ?? 'Something went wrong. Please try signing in again.'}
        </p>
        <Link href="/login">
          <Button>Back to sign in</Button>
        </Link>
      </div>
    </main>
  )
}
