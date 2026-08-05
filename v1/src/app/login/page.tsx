import { LoginForm } from './login-form'
import { isDemoMode } from '@/lib/demo'

export const metadata = { title: 'Sign in · Nerige Story Procurement' }

/** The demo walkthrough, in the order the weekly cycle actually runs. */
const DEMO_ENTRANCES = [
  {
    role: 'procurement_head',
    name: 'Pooja — Procurement Head',
    sees: 'What needs chasing, build the weekly order',
  },
  {
    role: 'warehouse_manager',
    name: 'Ravi — Warehouse Manager',
    sees: 'What is arriving, count it in',
  },
  {
    role: 'vendor',
    name: 'Shantiniketan Handlooms — Vendor',
    sees: 'Accept the order, look up my codes, send the bill',
  },
  {
    role: 'founder',
    name: 'Ashrith — Founder',
    sees: 'Everything, plus approving bills for payment',
  },
] as const

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

        {isDemoMode() ? (
          <div className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-6">
            <div className="text-center">
              <p className="text-sm font-semibold text-amber-900">Demo mode</p>
              <p className="text-sm text-amber-800">
                Sample data, no Supabase project needed. Pick who to be — each role lands on a
                different screen, which is the point.
              </p>
            </div>

            {/* One entry per role rather than a single admin account. The claim
                being demonstrated is that these three people see three
                different systems; a shared login would hide it. */}
            <ul className="space-y-2">
              {DEMO_ENTRANCES.map((entry) => (
                <li key={entry.role}>
                  <a
                    href={`/demo-login?as=${entry.role}`}
                    className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-amber-200 bg-white px-3 py-2 text-left hover:border-stone-300 hover:bg-stone-50"
                  >
                    <span>
                      <span className="block text-sm font-medium text-stone-900">{entry.name}</span>
                      <span className="block text-xs text-stone-500">{entry.sees}</span>
                    </span>
                    <span className="text-xs text-stone-400">→</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
            <LoginForm next={safeNext} />
          </div>
        )}

        <p className="text-center text-xs text-stone-400">
          Access is by invitation. Contact the procurement team if you cannot sign in.
        </p>
      </div>
    </main>
  )
}
