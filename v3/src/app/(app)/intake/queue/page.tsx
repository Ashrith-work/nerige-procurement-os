import Link from 'next/link'
import { format } from 'date-fns'
import { requireStaff } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { EmptyState, PageHeader, Select, Input, Button, cn } from '@/components/ui/primitives'
import { loadIntakeCounts, type IntakeCounts } from '@/lib/intake/summary'
import { INTAKE_STATUSES, isIntakeStatus, STAGE_LABELS, STAGE_STATUSES, STATUS_LABELS, type IntakeStage } from '@/lib/intake/status'
import { canSubmitIntake } from '@/lib/intake/transitions'
import { INTAKE_LIST_COLUMNS, loadIntakeContext, loadPeople, loadVocabulary, vocabLabel, type IntakeListRow } from '../_lib/data'
import { IntakeStatusBadge } from '../_components/intake-status-badge'

export const metadata = { title: 'Intake queue · Nerige' }

const LIMIT = 200

const STAGE_COUNT_KEY: Partial<Record<IntakeStage, keyof IntakeCounts>> = {
  draft: 'drafts',
  shoot: 'awaitingShoot',
  upload: 'awaitingUpload',
  review: 'awaitingReview',
  rejected: 'rejected',
  error: 'errors',
}

const STAGES: IntakeStage[] = ['error', 'draft', 'shoot', 'upload', 'review', 'rejected', 'approved']

/**
 * Every saree in intake, broken ones first.
 *
 * Readable by every staff role (migration 022): the warehouse team is more than
 * one person, procurement wants to know what is coming, and support answers
 * "where is this saree" about any of them.
 *
 * ERRORS FIRST, whatever the filter. "Show me what is broken" is the first
 * thing anyone opens a queue for, and an error on row 140 is an error nobody
 * sees. The stage chips carry counts so the size of each pile is visible
 * before it is opened.
 *
 * "Mine" filters on `user.id` explicitly rather than trusting the policy, which
 * is unscoped across staff — and while a developer views as a warehouse
 * manager, reads run under the developer's session anyway.
 */
export default async function IntakeQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ stage?: string; status?: string; who?: string; q?: string }>
}) {
  const user = await requireStaff()
  const params = await searchParams
  const submits = canSubmitIntake(user.role)

  // The manager's own work by default; everybody else sees everybody's.
  const who = submits ? (params.who === 'everyone' ? 'everyone' : params.who === 'mine' ? 'mine' : user.role === 'warehouse_manager' ? 'mine' : 'everyone') : 'everyone'
  const stage = (STAGES as string[]).includes(params.stage ?? '') ? (params.stage as IntakeStage) : null
  const status = isIntakeStatus(params.status) ? params.status : null
  const q = (params.q ?? '').trim()

  const supabase = await createClient()
  const mine = who === 'mine' ? user.id : undefined

  let query = supabase
    .from('product_intakes')
    .select(INTAKE_LIST_COLUMNS, { count: 'exact' })
    .order('error_status', { ascending: false })
    .order('updated_at', { ascending: false })
    .limit(LIMIT)

  if (mine) query = query.eq('submitted_by', mine)
  if (status) query = query.eq('status', status)
  else if (stage === 'error') query = query.or('error_status.eq.true,status.eq.ERROR')
  else if (stage) query = query.in('status', [...STAGE_STATUSES[stage]])
  if (q) {
    query = /^\d+$/.test(q) ? query.eq('unique_code', Number(q)) : query.ilike('sku', `%${q.replace(/[%_]/g, '')}%`)
  }

  const [{ data, count, error }, counts, context, vocab] = await Promise.all([
    query,
    loadIntakeCounts(supabase, { submittedBy: mine }),
    loadIntakeContext(supabase),
    loadVocabulary(supabase),
  ])

  const rows = (data ?? []) as unknown as IntakeListRow[]
  const people = await loadPeople(supabase, rows.map((r) => r.submitted_by))
  const vendorCode = new Map(context.vendors.map((v) => [v.id, v.code]))

  const href = (next: Record<string, string | null>) => {
    const merged = { stage: stage ?? null, status: status ?? null, who: submits ? who : null, q: q || null, ...next }
    const sp = new URLSearchParams()
    for (const [k, v] of Object.entries(merged)) if (v) sp.set(k, v)
    const s = sp.toString()
    return s ? `/intake/queue?${s}` : '/intake/queue'
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <PageHeader
        title="Intake queue"
        subtitle={who === 'mine' ? 'Sarees you submitted.' : 'Every saree in intake.'}
        action={
          submits && (
            <Link
              href="/intake/new"
              className="inline-flex min-h-11 items-center rounded-lg bg-stone-900 px-4 text-sm font-medium text-white hover:bg-stone-800"
            >
              New saree
            </Link>
          )
        }
      />

      {submits && (
        <div className="inline-flex rounded-lg border border-stone-300 p-0.5 text-sm">
          {(['mine', 'everyone'] as const).map((w) => (
            <Link
              key={w}
              href={href({ who: w })}
              className={cn('flex min-h-10 items-center rounded-md px-4', who === w ? 'bg-stone-900 text-white' : 'text-stone-700')}
            >
              {w === 'mine' ? 'Mine' : 'Everyone'}
            </Link>
          ))}
        </div>
      )}

      <nav className="flex flex-wrap gap-2" aria-label="Stages">
        <StageChip href={href({ stage: null, status: null })} active={!stage && !status} label="All" />
        {STAGES.map((s) => {
          const key = STAGE_COUNT_KEY[s]
          return (
            <StageChip
              key={s}
              href={href({ stage: s, status: null })}
              active={stage === s && !status}
              label={STAGE_LABELS[s]}
              count={key ? counts[key] : undefined}
              alarm={s === 'error' && counts.errors > 0}
            />
          )
        })}
      </nav>

      <form method="get" action="/intake/queue" className="flex flex-wrap items-end gap-2">
        {submits && <input type="hidden" name="who" value={who} />}
        <label className="text-xs text-stone-500">
          Status
          <Select name="status" defaultValue={status ?? ''} className="mt-1 w-auto min-w-48">
            <option value="">Any status</option>
            {INTAKE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </label>
        <label className="text-xs text-stone-500">
          Code or SKU
          <Input name="q" defaultValue={q} placeholder="16001 or PGW-BRHM" className="mt-1 w-48" />
        </label>
        <Button type="submit" variant="secondary">
          Filter
        </Button>
      </form>

      {error && <p className="text-sm text-red-700">Could not load the queue: {error.message}</p>}

      {rows.length === 0 ? (
        <EmptyState
          title="Nothing here"
          body={who === 'mine' ? 'You have no sarees matching this filter.' : 'No saree matches this filter.'}
        />
      ) : (
        <ul className="divide-y divide-stone-100 rounded-xl border border-stone-200 bg-white">
          {rows.map((r) => (
            <li key={r.unique_code}>
              <Link href={`/intake/${r.unique_code}`} className="block px-4 py-3 hover:bg-stone-50">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-mono text-lg font-semibold tabular-nums text-stone-900">{r.unique_code}</span>
                  <span className="font-mono text-sm break-all text-stone-700">{r.sku ?? 'Draft — no SKU yet'}</span>
                  <IntakeStatusBadge status={r.status} />
                  {r.error_status && (
                    <span className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-medium text-white">
                      Error · {r.error_stage}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-stone-600">
                  {vendorCode.get(r.vendor_id) ?? '—'} · {vocabLabel(vocab, 'collection', r.collection_code)} ·{' '}
                  {vocabLabel(vocab, 'fabric', r.fabric_code)} · {vocabLabel(vocab, 'colour', r.colour_code)}
                </p>
                {r.error_status && r.error_message && <p className="mt-1 text-sm text-red-700">{r.error_message}</p>}
                {r.status === 'DRAFT' && r.draft_note && <p className="mt-1 text-sm text-stone-500 italic">“{r.draft_note}”</p>}
                {r.status === 'REJECTED' && r.rejection_reason && (
                  <p className="mt-1 text-sm text-red-700">Rejected: {r.rejection_reason}</p>
                )}
                <p className="mt-1 text-xs text-stone-400">
                  Updated {format(new Date(r.updated_at), 'd MMM, HH:mm')}
                  {r.submitted_by && people.get(r.submitted_by) ? ` · by ${people.get(r.submitted_by)}` : ''}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {(count ?? 0) > rows.length && (
        <p className="text-sm text-stone-500">
          Showing the {rows.length} most recently updated of {count}. Narrow the filter to see the rest.
        </p>
      )}
    </div>
  )
}

function StageChip({ href, active, label, count, alarm }: { href: string; active: boolean; label: string; count?: number; alarm?: boolean }) {
  return (
    <Link
      href={href}
      className={cn(
        'inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm',
        active ? 'border-stone-900 bg-stone-900 text-white' : 'border-stone-300 bg-white text-stone-700 hover:bg-stone-50',
      )}
    >
      {label}
      {count !== undefined && (
        <span
          className={cn(
            'rounded-full px-1.5 text-xs tabular-nums',
            alarm ? 'bg-red-600 text-white' : active ? 'bg-white/20 text-white' : 'bg-stone-100 text-stone-600',
          )}
        >
          {count}
        </span>
      )}
    </Link>
  )
}
