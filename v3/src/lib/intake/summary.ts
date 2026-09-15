import type { SupabaseClient } from '@supabase/supabase-js'
import { STAGE_STATUSES } from './status'

/**
 * Intake counts by stage, for the dashboards that come after these screens.
 *
 * Head-only count queries, in parallel — no rows cross the wire. Each count is
 * run under the caller's own client, so RLS decides what is counted: staff read
 * every intake (migration 022), a weaver reads none.
 *
 * `submittedBy` narrows every count to one person's submissions. Pass
 * `user.id` explicitly for a "mine" view: while a developer views as the
 * warehouse manager the query runs under the developer's session, which reads
 * everything, so the filter cannot be left to the policy.
 */
export interface IntakeCounts {
  /** Saved as DRAFT, waiting — usually — for a vocabulary value. */
  drafts: number
  /** Has a SKU and a code on the fabric, not yet photographed. */
  awaitingShoot: number
  /** Photographed; photo count not yet recorded or not yet sent on. */
  awaitingUpload: number
  /** READY_FOR_REVIEW: procurement's queue. */
  awaitingReview: number
  /** Carrying a current error, or in the ERROR status. */
  errors: number
  /** Rejected at review and not yet reshot. */
  rejected: number
  /** Approved within the window (default: the last seven days). */
  approvedThisWeek: number
}

export interface IntakeCountOptions {
  submittedBy?: string
  /** The start of the "this week" window. Defaults to seven days before `now`. */
  since?: Date
  /** Injected for tests and for pages that already hold a request time. */
  now?: Date
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

export async function loadIntakeCounts(
  supabase: SupabaseClient,
  options: IntakeCountOptions = {},
): Promise<IntakeCounts> {
  const now = options.now ?? new Date()
  const since = options.since ?? new Date(now.getTime() - WEEK_MS)

  const base = () => {
    const q = supabase.from('product_intakes').select('unique_code', { count: 'exact', head: true })
    return options.submittedBy ? q.eq('submitted_by', options.submittedBy) : q
  }

  const results = await Promise.all([
    base().in('status', [...STAGE_STATUSES.draft]),
    base().in('status', [...STAGE_STATUSES.shoot]),
    base().in('status', [...STAGE_STATUSES.upload]),
    base().in('status', [...STAGE_STATUSES.review]),
    base().or('error_status.eq.true,status.eq.ERROR'),
    base().eq('status', 'REJECTED'),
    base().eq('approval_status', 'APPROVED').gte('approved_at', since.toISOString()),
  ])

  // A failed count is thrown, not reported as zero. A dashboard showing "0
  // errors" because the query failed is the one reading nobody double-checks.
  const failed = results.find((r) => r.error)
  if (failed?.error) throw new Error(`Could not count intakes: ${failed.error.message}`)

  const [drafts, awaitingShoot, awaitingUpload, awaitingReview, errors, rejected, approvedThisWeek] = results.map(
    (r) => r.count ?? 0,
  )

  return { drafts, awaitingShoot, awaitingUpload, awaitingReview, errors, rejected, approvedThisWeek }
}
