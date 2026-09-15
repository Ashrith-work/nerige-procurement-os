import Link from 'next/link'
import type { AppRole } from '@/lib/auth/session'
import { ROLE_LABEL } from '@/lib/auth/view-as'
import { stopViewAs } from '@/app/(app)/dev/actions'

/**
 * The strip that says whose screen this is, for the developer.
 *
 * Violet rather than the amber of Pooja's impersonation banner, so the two can
 * never be mistaken for each other in a screenshot sent for debugging. Above
 * everything, never scrolls away, and the way out is in the strip itself — the
 * moment it is needed is the moment the developer has forgotten where they are.
 */
export function ViewAsBanner({
  name,
  role,
  kind,
}: {
  name: string
  role: AppRole
  kind: 'user' | 'vendor' | 'role'
}) {
  return (
    <div className="no-print sticky top-0 z-50 border-b border-violet-300 bg-violet-100">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm text-violet-900">
        <span className="font-medium">Viewing as {name}</span>
        <span className="rounded bg-white/70 px-1.5 py-0.5 text-xs">{ROLE_LABEL[role]}</span>
        {kind === 'role' && (
          <span className="text-violet-700">No account holds this role yet — lists that show &ldquo;mine&rdquo; are empty.</span>
        )}
        <span className="text-violet-700">Read only — the database refuses every write.</span>

        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/dev"
            className="inline-flex min-h-9 items-center rounded-lg px-3 text-sm font-medium text-violet-900 hover:bg-violet-200"
          >
            Switch
          </Link>
          <form action={stopViewAs}>
            <button
              type="submit"
              className="min-h-9 rounded-lg border border-violet-400 bg-white px-3 text-sm font-medium text-violet-900 hover:bg-violet-50"
            >
              Stop viewing
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
