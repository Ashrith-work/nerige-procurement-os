import Link from 'next/link'
import { requireStaff, type AppRole } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { EmptyState, PageHeader } from '@/components/ui/primitives'
import { DashboardSection, SectionError, Tile, TileGrid, settle, toneWhen } from '@/components/dashboard/tile'
import { DashboardStrip } from '@/components/dashboard/strip'
import { loadIntakeCounts } from '@/lib/intake/summary'
import { loadInwardCounts } from '@/lib/inwarding/summary'
import { loadRoster, loadTodaySheetStatus } from '@/lib/performance/summary'
import { loadAdminQueue, loadOrderDecisions } from '@/lib/dashboards/today'
import { isStale, loadSyncAges } from '@/lib/dashboards/freshness'

export const metadata = { title: 'Today · Nerige' }

/**
 * Today: what is waiting on this person, and nothing else.
 *
 * One dashboard used to carry all three jobs — decisions, pipelines and
 * analytics — and the cost of that was not clutter but skimming: a person who
 * has learned that two thirds of a screen is background stops reading the third
 * that is not. So this screen now holds only work with somebody's name on it,
 * `/work` holds what is in flight, and `/numbers` holds every measurement. What
 * moved off here: accepted-and-being-woven and the intake pipeline went to
 * `/work`; approved this week, received this week and the whole staff-output
 * block went to `/numbers`.
 *
 * The test for a tile is the same every time: could this person do something
 * about it before they go home? A count of what is merely in progress cannot
 * pass it, and neither can a percentage.
 *
 * EVERY STAFF ROLE LANDS HERE, and each gets their own version rather than a
 * redirect. The warehouse manager's Today is the staff sheet, the parcels on
 * the bench and their own sarees; sending them to a different URL would mean
 * two screens to keep honest and a workspace switcher that lies about where
 * Today is.
 *
 * Sections load and fail independently. A dashboard that goes blank because one
 * count failed is a dashboard people stop opening.
 */
export default async function TodayPage() {
  const user = await requireStaff()
  const supabase = await createClient()

  const role = user.role
  const decides = role === 'admin' || role === 'procurement_head'
  const receives = decides || role === 'warehouse_manager'
  const recordsStaff = role === 'admin' || role === 'warehouse_manager'
  const submits = role === 'warehouse_manager'
  const isAdmin = role === 'admin'

  // "Mine" is scoped by user.id, never left to the policy: staff read every
  // intake, and while a developer views as the warehouse manager the queries
  // run under the developer's own session, which reads everything.
  const [intake, orders, inward, sheet, roster, admin, sync] = await Promise.all([
    decides || submits ? settle(() => loadIntakeCounts(supabase, submits ? { submittedBy: user.id } : {})) : null,
    decides ? settle(() => loadOrderDecisions(supabase)) : null,
    receives ? settle(() => loadInwardCounts(supabase)) : null,
    recordsStaff ? settle(() => loadTodaySheetStatus(supabase)) : null,
    recordsStaff ? settle(() => loadRoster(supabase)) : null,
    isAdmin ? settle(() => loadAdminQueue(supabase)) : null,
    isAdmin ? settle(() => loadSyncAges(supabase)) : null,
  ])

  const rosterEmpty = roster?.ok === true && roster.value.length === 0
  const sheetWaiting =
    sheet?.ok === true && sheet.value.expected > 0 && sheet.value.state !== 'complete' ? 1 : 0
  const syncStale = sync?.ok === true && isStale(sync.value.products)

  // Everything on this screen, added up. Only loaded sections count, so a
  // failure can never be mistaken for a quiet day.
  const waiting = [
    decides && intake?.ok ? intake.value.awaitingReview + intake.value.errors : 0,
    decides && orders?.ok ? orders.value.issued : 0,
    receives && inward?.ok ? inward.value.expected + inward.value.partiallyReceived : 0,
    decides && inward?.ok ? inward.value.lateNotDispatched : 0,
    submits && intake?.ok
      ? intake.value.awaitingShoot + intake.value.awaitingUpload + intake.value.rejected + intake.value.errors
      : 0,
    sheetWaiting,
    isAdmin && admin?.ok ? admin.value.signups + admin.value.unidentified + admin.value.unnamedCodes : 0,
    syncStale ? 1 : 0,
  ].reduce((a, b) => a + b, 0)

  const loaded = [intake, orders, inward, sheet, roster, admin, sync]
  const allLoaded = loaded.every((r) => r === null || r.ok)
  const clear = allLoaded && waiting === 0

  const firstName = user.fullName.split(' ')[0]
  const start = STARTERS[role]

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <DashboardStrip current="today" role={role} />

      <PageHeader
        title={`Today, ${firstName}`}
        subtitle="What is waiting on you. Every tile opens the place to do it."
        action={
          <Link
            href={start[0].href}
            className="inline-flex min-h-11 items-center rounded-lg bg-stone-900 px-4 text-sm font-medium text-white hover:bg-stone-800 focus-visible:ring-2 focus-visible:ring-stone-900 focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            {start[0].label}
          </Link>
        }
      />

      {clear ? (
        <EmptyState
          title="Nothing is waiting on you"
          body={CLEAR_BODY[role]}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              {start.map((s) => (
                <Link
                  key={s.href}
                  href={s.href}
                  className="inline-flex min-h-11 items-center rounded-lg border border-stone-300 bg-white px-4 text-sm font-medium text-stone-900 hover:bg-stone-50 focus-visible:ring-2 focus-visible:ring-stone-400 focus-visible:ring-offset-2 focus-visible:outline-none"
                >
                  {s.label}
                </Link>
              ))}
            </div>
          }
        />
      ) : (
        <div className="space-y-8">
          {decides && (
            <DashboardSection title="Needs a decision">
              <TileGrid>
                {intake?.ok && (
                  <Tile
                    href="/review"
                    label="Sarees awaiting review"
                    value={intake.value.awaitingReview}
                    tone={toneWhen(intake.value.awaitingReview, 'waiting')}
                  />
                )}
                {orders?.ok && (
                  <Tile
                    href="/orders"
                    label="Orders not yet accepted"
                    value={orders.value.issued}
                    hint={orders.value.issuedStale > 0 ? `${orders.value.issuedStale} waiting over 3 days` : undefined}
                    tone={toneWhen(orders.value.issuedStale, 'waiting')}
                  />
                )}
                {inward?.ok && (
                  <Tile
                    href="/warehouse/inward"
                    label="Weavers past their promised date"
                    value={inward.value.lateNotDispatched}
                    hint="Accepted, date passed, not sent"
                    tone={toneWhen(inward.value.lateNotDispatched, 'bad')}
                  />
                )}
                {intake?.ok && (
                  <Tile
                    href="/intake/queue?stage=error"
                    label="Sarees that went wrong"
                    value={intake.value.errors}
                    hint="Stuck part-way through being added"
                    tone={toneWhen(intake.value.errors, 'bad')}
                  />
                )}
              </TileGrid>
              {intake && !intake.ok && <SectionError message={intake.error} />}
              {orders && !orders.ok && <SectionError message={orders.error} />}
              {inward && !inward.ok && <SectionError message={inward.error} />}
            </DashboardSection>
          )}

          {recordsStaff && sheet && (
            <DashboardSection title="The floor today">
              {sheet.ok ? (
                <TileGrid>
                  <Tile
                    href="/warehouse/staff"
                    label="Today’s staff sheet"
                    value={
                      rosterEmpty
                        ? 'No floor staff yet'
                        : sheet.value.state === 'not_expected'
                          ? 'Not a working day'
                          : sheet.value.state === 'complete'
                            ? `All ${sheet.value.expected} recorded`
                            : `${sheet.value.recorded} of ${sheet.value.expected}`
                    }
                    hint={
                      rosterEmpty
                        ? 'Add the floor staff before a day can be recorded'
                        : sheet.value.missing.length > 0
                          ? `Still to do: ${sheet.value.missing.map((m) => m.name).join(', ')}`
                          : undefined
                    }
                    tone={
                      sheet.value.state === 'complete'
                        ? 'good'
                        : sheet.value.state === 'not_expected'
                          ? 'neutral'
                          : 'waiting'
                    }
                  />
                </TileGrid>
              ) : (
                <SectionError message={sheet.error} />
              )}
            </DashboardSection>
          )}

          {receives && inward && (
            <DashboardSection title="Parcels to record">
              {inward.ok ? (
                <TileGrid>
                  <Tile
                    href="/warehouse/inward"
                    label="Sent, not yet at the bench"
                    value={inward.value.expected}
                    hint="Record each one as it arrives"
                    tone={toneWhen(inward.value.expected, 'waiting')}
                  />
                  <Tile
                    href="/warehouse/inward"
                    label="Partly received"
                    value={inward.value.partiallyReceived}
                    hint="Pieces still owed on an open parcel"
                    tone={toneWhen(inward.value.partiallyReceived, 'waiting')}
                  />
                </TileGrid>
              ) : (
                <SectionError message={inward.error} />
              )}
            </DashboardSection>
          )}

          {submits && intake && (
            <DashboardSection title="Sarees you are adding">
              {intake.ok ? (
                <TileGrid>
                  <Tile
                    href="/warehouse/shooting"
                    label="Waiting to be shot"
                    value={intake.value.awaitingShoot}
                    tone={toneWhen(intake.value.awaitingShoot, 'waiting')}
                  />
                  <Tile
                    href="/warehouse/shooting"
                    label="Shot, photos not sent on"
                    value={intake.value.awaitingUpload}
                    tone={toneWhen(intake.value.awaitingUpload, 'waiting')}
                  />
                  <Tile
                    href="/intake/queue?stage=rejected"
                    label="Sent back — needs a reshoot"
                    value={intake.value.rejected}
                    tone={toneWhen(intake.value.rejected, 'bad')}
                  />
                  <Tile
                    href="/intake/queue?stage=error"
                    label="Went wrong"
                    value={intake.value.errors}
                    tone={toneWhen(intake.value.errors, 'bad')}
                  />
                </TileGrid>
              ) : (
                <SectionError message={intake.error} />
              )}
            </DashboardSection>
          )}

          {isAdmin && (
            <DashboardSection title="Only you can do">
              {admin?.ok ? (
                <TileGrid>
                  <Tile
                    href="/admin/signups"
                    label="Account requests"
                    value={admin.value.signups}
                    tone={toneWhen(admin.value.signups, 'waiting')}
                  />
                  <Tile
                    href="/admin/products/unidentified"
                    label="Sarees with no weaver"
                    value={admin.value.unidentified}
                    tone={toneWhen(admin.value.unidentified, 'waiting')}
                  />
                  <Tile
                    href="/admin/master-data"
                    label="Unnamed saree words"
                    value={admin.value.unnamedCodes}
                    hint="Codes in a SKU nobody has named"
                    tone={toneWhen(admin.value.unnamedCodes, 'waiting')}
                  />
                  {syncStale && sync?.ok && (
                    <Tile
                      href="/admin/settings"
                      label="Shopify sync"
                      value={sync.value.products ? 'Over a day old' : 'Never succeeded'}
                      hint="Stock and sales figures are not current"
                      tone="bad"
                    />
                  )}
                </TileGrid>
              ) : (
                <SectionError message={admin?.error ?? 'unknown'} />
              )}
              {sync && !sync.ok && <SectionError message={sync.error} />}
            </DashboardSection>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * The two things each role starts most often.
 *
 * The first is also the button in the header, so the primary action is in the
 * same place whether or not there is a queue — a screen whose one control moves
 * depending on how the day is going teaches nobody anything.
 */
const STARTERS: Record<AppRole, { label: string; href: string }[]> = {
  admin: [
    { label: 'Order sarees', href: '/flows/order' },
    { label: 'Reorder grid', href: '/reorder' },
  ],
  procurement_head: [
    { label: 'Order sarees', href: '/flows/order' },
    { label: 'Reorder grid', href: '/reorder' },
  ],
  warehouse_manager: [
    { label: 'Add a saree', href: '/flows/new-saree' },
    { label: 'Receive a parcel', href: '/flows/receive' },
  ],
  customer_support: [
    { label: 'Look something up', href: '/lookup' },
    { label: 'Sarees being added', href: '/intake/queue' },
  ],
  // Neither role reaches this screen — requireStaff() refuses both — but the
  // map is total so that adding a role is a compile error here rather than a
  // crash on somebody's first morning.
  vendor: [{ label: 'My orders', href: '/portal' }],
  developer: [{ label: 'Developer home', href: '/dev' }],
}

const CLEAR_BODY: Record<AppRole, string> = {
  admin: 'Nothing is at review, no weaver is overdue and every parcel is recorded. Start something instead.',
  procurement_head:
    'Nothing is at review, no weaver is overdue and every parcel is recorded. Start something instead.',
  warehouse_manager: 'The sheet is filled, nothing is waiting for the camera and no parcel is open.',
  customer_support: 'Nothing here waits on you. This screen is where a queue would appear if one did.',
  vendor: 'Nothing is waiting.',
  developer: 'Nothing is waiting.',
}
