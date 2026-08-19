import { requireAdmin } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { PageHeader, EmptyState } from '@/components/ui/primitives'
import { toAuthEmail } from '@/lib/auth/user-id'
import { DecisionRow, type SignupRow } from './decision-row'

export const metadata = { title: 'Account requests · Nerige' }

/**
 * Who has asked for a login, and the decision only the owner can make.
 *
 * Admin only, matching the table's own policy. A request carries somebody's
 * name and phone number before anyone has agreed they belong in the system,
 * and deciding who gets in is the same authority as deciding what a weaver is
 * paid — procurement does not need it in order to do procurement.
 *
 * Pending first and oldest first: a request that has waited longest is the one
 * somebody is still waiting on. Decided requests stay visible underneath,
 * because "did we ever action that?" is otherwise unanswerable from inside the
 * portal.
 */
export default async function SignupsPage() {
  await requireAdmin()
  const supabase = await createClient()

  const { data: pending } = await supabase
    .from('signup_requests')
    .select('id, user_id, full_name, requested_role, vendor_code, phone, note, created_at')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })

  const { data: decided } = await supabase
    .from('signup_requests')
    .select('id, user_id, full_name, requested_role, status, decided_at, decision_note')
    .neq('status', 'pending')
    .order('decided_at', { ascending: false })
    .limit(25)

  const requests = pending ?? []

  // Which of these identities already has a login. Needs the service role: the
  // answer lives in auth.users, which no policy exposes and nothing else in the
  // application reads. Read-only, and the result is a boolean per row — an
  // admin looking at an approval queue is exactly who should be told "this
  // person already has an account" BEFORE pressing a button that will fail on
  // a duplicate email.
  const emails = requests
    .map((r) => toAuthEmail(r.user_id as string))
    .filter((e): e is string => e !== null)

  const existing = new Set<string>()
  if (emails.length > 0) {
    const service = createAdminClient()
    const { data: profiles } = await service.from('app_users').select('email').in('email', emails)
    for (const p of profiles ?? []) if (p.email) existing.add(String(p.email).toLowerCase())
  }

  const rows: SignupRow[] = requests.map((r) => ({
    id: r.id as string,
    userId: r.user_id as string,
    fullName: r.full_name as string,
    requestedRole: r.requested_role as string,
    vendorCode: (r.vendor_code as string) ?? null,
    phone: (r.phone as string) ?? null,
    note: (r.note as string) ?? null,
    createdAt: r.created_at as string,
    alreadyHasAccount: existing.has((toAuthEmail(r.user_id as string) ?? '').toLowerCase()),
  }))

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="Account requests"
        subtitle={
          rows.length === 0
            ? 'Nobody is waiting.'
            : `${rows.length} waiting. Approving creates the login and shows a password once.`
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          title="Nothing waiting"
          body="Requests made at /signup appear here for you to approve."
        />
      ) : (
        <ul className="rounded border border-stone-200 bg-white px-4">
          {rows.map((r) => (
            <DecisionRow key={r.id} request={r} />
          ))}
        </ul>
      )}

      {(decided ?? []).length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-stone-700">Recently decided</h2>
          <ul className="rounded border border-stone-200 bg-white divide-y divide-stone-100">
            {(decided ?? []).map((d) => (
              <li key={d.id as string} className="flex flex-wrap gap-x-2 px-4 py-2 text-sm">
                <span className="font-mono text-stone-600">{d.user_id as string}</span>
                <span className="text-stone-900">{d.full_name as string}</span>
                <span
                  className={
                    d.status === 'approved' ? 'text-emerald-700' : 'text-stone-500'
                  }
                >
                  {d.status as string}
                </span>
                {d.decision_note && (
                  <span className="text-stone-500 italic">{d.decision_note as string}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
