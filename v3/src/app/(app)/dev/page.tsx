import { formatDistanceToNow } from 'date-fns'
import { requireDeveloper, type AppRole } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { ROLE_LABEL, VIEWABLE_ROLES } from '@/lib/auth/view-as'
import { Card, PageHeader, StatusBadge } from '@/components/ui/primitives'
import { startViewAs } from './actions'

export const metadata = { title: 'Developer' }

/**
 * The developer's home: every role's screens one press away, and the handful
 * of health signals that say whether what those screens show can be trusted.
 *
 * Grouped by role rather than listed by person, because the question asked on
 * arriving here is "does the warehouse manager's home work", and only then
 * "for whom". A role with no account yet still gets a button — a preview under
 * the developer's own id — so a screen can be checked before anybody is given
 * the login that reaches it.
 */

const LANDS_ON: Record<Exclude<AppRole, 'developer'>, string> = {
  admin: '/dashboard',
  procurement_head: '/dashboard',
  warehouse_manager: '/warehouse',
  customer_support: '/lookup',
  vendor: '/portal',
}

interface UserRow {
  id: string
  role: AppRole
  full_name: string
  email: string | null
  status: string
  last_seen_at: string | null
}

export default async function DeveloperPage() {
  const developer = await requireDeveloper()
  const supabase = await createClient()

  const [users, vendors, syncs, intakeErrors, signups, log] = await Promise.all([
    supabase
      .from('app_users')
      .select('id, role, full_name, email, status, last_seen_at')
      .is('deleted_at', null)
      .neq('role', 'developer')
      .order('full_name'),
    supabase
      .from('vendors')
      .select('id, code, display_name, status')
      .is('deleted_at', null)
      .order('code'),
    supabase
      .from('sync_runs')
      .select('kind, status, started_at, finished_at, error')
      .order('started_at', { ascending: false })
      .limit(8),
    supabase.from('intake_errors').select('id', { count: 'exact', head: true }).eq('resolved', false),
    supabase
      .from('signup_requests')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending'),
    supabase
      .from('view_as_log')
      .select('target_role, started_at, ended_at, app_users!view_as_log_target_user_id_fkey(full_name)')
      .eq('developer_user_id', developer.id)
      .order('started_at', { ascending: false })
      .limit(8),
  ])

  const byRole = new Map<AppRole, UserRow[]>()
  for (const u of (users.data ?? []) as UserRow[]) {
    byRole.set(u.role, [...(byRole.get(u.role) ?? []), u])
  }

  const lastRun = syncs.data?.[0]
  const stuck = countStuck(syncs.data ?? [])

  return (
    <div className="space-y-8">
      <PageHeader
        title="Developer"
        subtitle="Open any role's screens exactly as that person sees them. Read only — the database refuses every write from this login."
      />

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Health
          label="Last sync"
          value={lastRun ? `${lastRun.status}, ${formatDistanceToNow(new Date(lastRun.started_at))} ago` : 'never'}
          bad={!lastRun || lastRun.status === 'failed'}
        />
        <Health label="Sync runs stuck > 1h" value={String(stuck)} bad={stuck > 0} />
        <Health label="Open intake errors" value={String(intakeErrors.count ?? 0)} bad={(intakeErrors.count ?? 0) > 0} />
        <Health label="Account requests waiting" value={String(signups.count ?? 0)} bad={false} />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-stone-500">Staff roles</h2>
        <div className="grid gap-3 lg:grid-cols-2">
          {VIEWABLE_ROLES.filter((r) => r !== 'vendor').map((role) => {
            const people = byRole.get(role) ?? []
            return (
              <Card key={role} className="space-y-3">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="font-medium">{ROLE_LABEL[role]}</p>
                  <p className="font-mono text-xs text-stone-400">{LANDS_ON[role]}</p>
                </div>

                {people.length === 0 ? (
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm text-stone-500">No account holds this role yet.</p>
                    <ViewButton target={`role:${role}`} label="Preview role" />
                  </div>
                ) : (
                  <ul className="divide-y divide-stone-100">
                    {people.map((p) => (
                      <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm">{p.full_name}</p>
                          <p className="truncate text-xs text-stone-500">
                            {p.email}
                            {p.status !== 'active' && ` · ${p.status}`}
                          </p>
                        </div>
                        {p.status === 'active' ? (
                          <ViewButton target={`user:${p.id}`} label="View as" />
                        ) : (
                          <StatusBadge status={p.status} />
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            )
          })}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-stone-500">
          Weavers <span className="text-stone-400">· {vendors.data?.length ?? 0} houses, {byRole.get('vendor')?.length ?? 0} logins</span>
        </h2>
        <Card className="p-0">
          <ul className="grid divide-y divide-stone-100 sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-3">
            {(vendors.data ?? []).map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-2 px-4 py-2">
                <span className="min-w-0 truncate text-sm">
                  <span className="font-mono text-xs text-stone-500">{v.code}</span> {v.display_name}
                </span>
                <ViewButton target={`vendor:${v.id}`} label="View" />
              </li>
            ))}
          </ul>
        </Card>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-stone-500">Other apps</h2>
        <Card className="text-sm text-stone-600">
          The dispatch board is a separate app with its own login. Its <span className="font-mono">developer</span> role
          sees the whole board read-only — provision one with{' '}
          <code className="rounded bg-stone-100 px-1">npm run provision -- --role developer</code> in{' '}
          <span className="font-mono">nerige-dispatch</span>.
        </Card>
      </section>

      {(log.data?.length ?? 0) > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-stone-500">Your recent views</h2>
          <ul className="space-y-1 text-sm text-stone-600">
            {(log.data ?? []).map((row, i) => {
              const target = Array.isArray(row.app_users) ? row.app_users[0] : row.app_users
              return (
                <li key={i}>
                  {ROLE_LABEL[row.target_role as AppRole]} · {(target as { full_name?: string } | null)?.full_name} ·{' '}
                  {formatDistanceToNow(new Date(row.started_at))} ago
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </div>
  )
}

/** A run still `running` an hour after it began was killed, not slow. */
function countStuck(runs: { status: string; started_at: string }[]): number {
  const cutoff = Date.now() - 60 * 60 * 1000
  return runs.filter((r) => r.status === 'running' && new Date(r.started_at).getTime() < cutoff).length
}

function ViewButton({ target, label }: { target: string; label: string }) {
  return (
    <form action={startViewAs}>
      <input type="hidden" name="target" value={target} />
      <button
        type="submit"
        className="min-h-9 shrink-0 rounded-lg border border-stone-300 px-3 text-sm font-medium hover:bg-stone-50"
      >
        {label}
      </button>
    </form>
  )
}

function Health({ label, value, bad }: { label: string; value: string; bad: boolean }) {
  return (
    <Card className={bad ? 'border-red-200 bg-red-50' : undefined}>
      <p className="text-xs text-stone-500">{label}</p>
      <p className={bad ? 'mt-1 font-medium text-red-800' : 'mt-1 font-medium'}>{value}</p>
    </Card>
  )
}
