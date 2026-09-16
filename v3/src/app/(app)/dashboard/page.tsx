import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'
import type { SupabaseClient } from '@supabase/supabase-js'
import { requireProcurement } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui/primitives'
import { DashboardSection, SectionError, Tile, TileGrid, settle, toneWhen } from '@/components/dashboard/tile'
import { loadIntakeCounts } from '@/lib/intake/summary'
import { loadInwardCounts } from '@/lib/inwarding/summary'
import { loadPeriodSummary, loadRoster, loadTodaySheetStatus } from '@/lib/performance/summary'
import { startOfWeek, todayInWarehouse } from '@/lib/performance/period'
import { formatPercent } from '@/lib/performance/calc'

export const metadata = { title: 'Dashboard · Nerige' }

/**
 * Pooja's home, and the owner's.
 *
 * It answers one question — what needs me today — and then gets out of the
 * way. Every number is something waiting on a person: a saree at review, a
 * weaver late on a promise, a parcel on its way to the bench. Totals that
 * nobody acts on (catalogue size, lifetime orders) are deliberately absent;
 * they live on Insights.
 *
 * The warehouse section is the owner's alone. The floor-staff sheet is the
 * founders' to review (migration 034 grants it to admin and the warehouse
 * manager, not to procurement), so Pooja's dashboard does not ask a question
 * her login cannot answer.
 *
 * Each section loads independently and fails independently. A dashboard that
 * goes blank because one count failed is a dashboard people stop opening.
 */
export default async function DashboardPage() {
  const user = await requireProcurement()
  const supabase = await createClient()
  const isOwner = user.role === 'admin'

  const [orders, intake, inward, sync, adminQueue, sheet, week] = await Promise.all([
    settle(() => loadOrderCounts(supabase)),
    settle(() => loadIntakeCounts(supabase)),
    settle(() => loadInwardCounts(supabase)),
    settle(() => loadLastSync(supabase)),
    isOwner ? settle(() => loadAdminQueue(supabase)) : null,
    isOwner ? settle(() => loadTodaySheetStatus(supabase)) : null,
    isOwner ? settle(() => loadWeek(supabase)) : null,
  ])

  const firstName = user.fullName.split(' ')[0]

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <PageHeader
        title={`Today, ${firstName}`}
        subtitle="What is waiting on you. Every number opens the place to act on it."
        action={
          <Link
            href="/reorder"
            className="inline-flex min-h-11 items-center rounded-lg bg-stone-900 px-4 text-sm font-medium text-white hover:bg-stone-800"
          >
            Reorder
          </Link>
        }
      />

      <DashboardSection title="Needs a decision">
        <TileGrid>
          {intake.ok ? (
            <Tile
              href="/review"
              label="Sarees awaiting review"
              value={intake.value.awaitingReview}
              tone={toneWhen(intake.value.awaitingReview, 'waiting')}
            />
          ) : null}
          {orders.ok ? (
            <Tile
              href="/orders"
              label="Orders not yet accepted"
              value={orders.value.issued}
              hint={orders.value.issuedStale > 0 ? `${orders.value.issuedStale} waiting over 3 days` : undefined}
              tone={toneWhen(orders.value.issuedStale, 'waiting')}
            />
          ) : null}
          {inward.ok ? (
            <Tile
              href="/warehouse/inward"
              label="Weavers late on a promise"
              value={inward.value.lateNotDispatched}
              hint="Accepted, promised date passed, not sent"
              tone={toneWhen(inward.value.lateNotDispatched, 'bad')}
            />
          ) : null}
          {intake.ok ? (
            <Tile
              href="/intake/queue?stage=error"
              label="Intake errors"
              value={intake.value.errors}
              tone={toneWhen(intake.value.errors, 'bad')}
            />
          ) : null}
        </TileGrid>
        {!intake.ok && <SectionError message={intake.error} />}
        {!orders.ok && <SectionError message={orders.error} />}
      </DashboardSection>

      <DashboardSection title="On its way">
        {inward.ok ? (
          <TileGrid>
            <Tile href="/orders" label="Accepted, being woven" value={orders.ok ? orders.value.accepted : '—'} />
            <Tile
              href="/warehouse/inward"
              label="Dispatched, not yet at the bench"
              value={inward.value.expected}
              tone={toneWhen(inward.value.expected, 'waiting')}
            />
            <Tile href="/warehouse/inward" label="Partly received" value={inward.value.partiallyReceived} />
            <Tile href="/warehouse/inward" label="Received this week" value={inward.value.receivedThisWeek} tone="good" />
          </TileGrid>
        ) : (
          <SectionError message={inward.error} />
        )}
      </DashboardSection>

      <DashboardSection title="New sarees">
        {intake.ok ? (
          <TileGrid>
            <Tile href="/intake/queue" label="Drafts" value={intake.value.drafts} hint="Usually a missing master-data value" />
            <Tile href="/warehouse/shooting" label="Waiting to be shot" value={intake.value.awaitingShoot} />
            <Tile href="/warehouse/shooting" label="Shot, photos pending" value={intake.value.awaitingUpload} />
            <Tile href="/review" label="Approved this week" value={intake.value.approvedThisWeek} tone="good" />
          </TileGrid>
        ) : (
          <SectionError message={intake.error} />
        )}
      </DashboardSection>

      {isOwner && (
        <DashboardSection
          title="Warehouse floor"
          action={
            <Link href="/admin/performance" className="text-sm text-stone-600 underline-offset-2 hover:underline">
              Full review
            </Link>
          }
        >
          {sheet?.ok && week?.ok ? (
            <TileGrid>
              <Tile
                href="/admin/performance"
                label="Today's staff sheet"
                value={
                  sheet.value.expected === 0
                    ? week.value.rosterSize === 0
                      ? 'No staff yet'
                      : 'Day off'
                    : `${sheet.value.recorded} of ${sheet.value.expected}`
                }
                hint={sheet.value.missing.length > 0 ? `Not yet: ${sheet.value.missing.map((m) => m.name).join(', ')}` : undefined}
                tone={sheet.value.state === 'complete' ? 'good' : sheet.value.state === 'not_expected' ? 'neutral' : 'waiting'}
              />
              <Tile
                href="/admin/performance"
                label="Sheet filled this week"
                value={`${week.value.completeDates} of ${week.value.expectedDates} days`}
                tone={toneWhen(week.value.expectedDates - week.value.completeDates, 'waiting')}
              />
              <Tile
                href="/admin/performance"
                label="Team output this week"
                value={formatPercent(week.value.output)}
                hint="Against attendance-adjusted targets"
              />
              <Tile
                href="/admin/performance"
                label="Quality flags this week"
                value={week.value.flags}
                tone={toneWhen(week.value.flags, 'waiting')}
              />
            </TileGrid>
          ) : (
            <SectionError message={(sheet && !sheet.ok && sheet.error) || (week && !week.ok && week.error) || 'unknown'} />
          )}
        </DashboardSection>
      )}

      {isOwner && adminQueue && (
        <DashboardSection title="Only you can do">
          {adminQueue.ok ? (
            <TileGrid>
              <Tile
                href="/admin/signups"
                label="Account requests"
                value={adminQueue.value.signups}
                tone={toneWhen(adminQueue.value.signups, 'waiting')}
              />
              <Tile
                href="/admin/products/unidentified"
                label="Sarees with no weaver"
                value={adminQueue.value.unidentified}
                tone={toneWhen(adminQueue.value.unidentified, 'waiting')}
              />
              <Tile
                href="/admin/master-data"
                label="Unnamed master-data codes"
                value={adminQueue.value.unnamedCodes}
                tone={toneWhen(adminQueue.value.unnamedCodes, 'waiting')}
              />
            </TileGrid>
          ) : (
            <SectionError message={adminQueue.error} />
          )}
        </DashboardSection>
      )}

      <p className="text-xs text-stone-500">
        {sync.ok
          ? sync.value
            ? `Catalogue and stock last synced from Shopify ${formatDistanceToNow(new Date(sync.value))} ago.`
            : 'The Shopify sync has never succeeded — stock figures are not current.'
          : `Could not read the sync status: ${sync.error}`}
      </p>
    </div>
  )
}

/** Orders waiting on a weaver to accept, and how many have waited too long. */
async function loadOrderCounts(supabase: SupabaseClient) {
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
  const head = () => supabase.from('orders').select('id', { count: 'exact', head: true })
  const [issued, issuedStale, accepted] = await Promise.all([
    head().eq('status', 'issued'),
    head().eq('status', 'issued').lt('issued_at', threeDaysAgo),
    head().eq('status', 'accepted'),
  ])
  const failed = [issued, issuedStale, accepted].find((r) => r.error)?.error
  if (failed) throw new Error(failed.message)
  return { issued: issued.count ?? 0, issuedStale: issuedStale.count ?? 0, accepted: accepted.count ?? 0 }
}

async function loadAdminQueue(supabase: SupabaseClient) {
  const [signups, unidentified, unnamed] = await Promise.all([
    supabase.from('signup_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase
      .from('products')
      .select('sku, vendors!inner(is_placeholder)', { count: 'exact', head: true })
      .eq('vendors.is_placeholder', true),
    supabase
      .from('master_data')
      .select('code', { count: 'exact', head: true })
      .eq('status', 'unnamed'),
  ])
  const failed = [signups, unidentified, unnamed].find((r) => r.error)?.error
  if (failed) throw new Error(failed.message)
  return { signups: signups.count ?? 0, unidentified: unidentified.count ?? 0, unnamedCodes: unnamed.count ?? 0 }
}

/** When the product sync last WORKED — not last ran. See migration 014. */
async function loadLastSync(supabase: SupabaseClient): Promise<string | null> {
  const { data, error } = await supabase
    .from('sync_runs')
    .select('finished_at')
    .eq('kind', 'shopify_products')
    .eq('status', 'succeeded')
    .order('finished_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data?.finished_at as string | undefined) ?? null
}

/** This week so far, Monday to today, reduced to the four numbers the tiles show. */
async function loadWeek(supabase: SupabaseClient) {
  const today = todayInWarehouse()
  // The roster itself, not summary.people: buildPeriodSummary drops anyone with
  // no expected days and no records, so an empty week would otherwise read as an
  // empty roster and the tile would say "no staff yet" about six people.
  const [summary, roster] = await Promise.all([
    loadPeriodSummary(supabase, { from: startOfWeek(today), to: today }),
    loadRoster(supabase),
  ])

  // The team's figure is total target-days of work over total days present,
  // counting only people with targeted work — the same definition outputIndex()
  // uses per person, summed. Averaging each person's ratio instead would let a
  // half day count as much as a full one.
  let targetDays = 0
  let attendanceDays = 0
  for (const p of summary.people) {
    if (p.output.ratio === null) continue
    targetDays += p.output.targetDays
    attendanceDays += p.attendanceDays
  }

  return {
    rosterSize: roster.length,
    expectedDates: summary.totals.expectedDates,
    completeDates: summary.totals.completeDates,
    flags: summary.totals.flags,
    output: attendanceDays > 0 ? targetDays / attendanceDays : null,
  }
}
