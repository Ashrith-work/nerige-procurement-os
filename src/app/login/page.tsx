import { LoginForm } from './login-form'

export const metadata = { title: 'Sign in · Nerige Story Procurement' }

export default async function LoginPage({
  searchParams,
}: {
  // Next.js 16: searchParams is async.
  searchParams: Promise<{ next?: string }>
}) {
  const { next } = await searchParams
  // Only same-origin paths survive, so a crafted ?next= cannot turn the login
  // screen into an open redirect.
  const safeNext = next?.startsWith('/') && !next.startsWith('//') ? next : '/'

  return (
    <main className="flex min-h-dvh items-center justify-center bg-stone-50 px-4 py-10">
      <div className="w-full max-w-sm space-y-6">
        <header className="space-y-1 text-center">
          <h1 className="text-xl font-semibold tracking-tight text-stone-900">Nerige Story</h1>
          <p className="text-sm text-stone-500">Procurement</p>
        </header>

        <div className="rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
          <LoginForm next={safeNext} />
        </div>

        <p className="text-center text-xs text-stone-400">
          Access is by invitation. Contact the procurement team if you cannot sign in.
        </p>
      </div>
    </main>
  )
}
