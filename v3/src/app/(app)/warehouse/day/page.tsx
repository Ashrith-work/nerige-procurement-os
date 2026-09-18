import { requireStaff } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { Alert, PageHeader } from '@/components/ui/primitives'
import { loadRoster } from '@/lib/performance/summary'
import { formatLongDay, isIsoDate, todayInWarehouse, type IsoDate } from '@/lib/performance/period'
import { canRecordDay, emptyTotals, type DayOrders, type MovementRow } from '@/lib/day-sheet/calc'
import {
  loadDayOrders,
  loadDayTotals,
  loadMovements,
  loadSkuKnowledge,
  loadStaffDay,
  type StaffDayLine,
} from '@/lib/day-sheet/loaders'
import { DaySheet } from './day-sheet'
import { OrdersSection } from './orders-section'
import { StaffSection } from './staff-section'

export const metadata = { title: 'Day sheet' }

/** Resolved outside the component body: the purity rule forbids reading the clock in render. */
function resolveDate(requested: string | undefined): { date: IsoDate; today: IsoDate; clamped: boolean } {
  const today = todayInWarehouse()
  if (!isIsoDate(requested)) return { date: today, today, clamped: false }
  if (requested > today) return { date: today, today, clamped: true }
  return { date: requested, today, clamped: false }
}

/** A loader that throws, turned into a value and a sentence. */
async function attempt<T>(load: () => Promise<T>): Promise<{ value: T | null; error: string | null }> {
  try {
    return { value: await load(), error: null }
  } catch (err) {
    return { value: null, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * The warehouse day sheet — the page out of the manager's notebook.
 *
 * It reads top to bottom exactly as the page does: the date, then each
 * in-house movement with what went out, what came back and what is missing,
 * then the day's orders, then who worked on what.
 *
 * THE TWO HALVES ARE NOT THE SAME KIND OF THING, and the screen should never
 * pretend they are. The top half is a person's observation — which saree
 * physically left the building and why it did not come back — and nothing but a
 * person can supply it. The bottom half is already in two databases, so it is
 * quoted, never asked for. Every input on this page is in the top half.
 *
 * Any past day can be opened. Reading is every staff role's, because "did that
 * saree come back" is asked on the phone; writing is the manager's and the
 * owner's, exactly as `app.can_record_day()` has it.
 */
export default async function WarehouseDayPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>
}) {
  const params = await searchParams
  const user = await requireStaff()
  const { date, today, clamped } = resolveDate(params.date)
  const supabase = await createClient()

  const canRecord = canRecordDay(user.role)
  // The staff register is the manager's and the founders'. Procurement and
  // support hold no read on those tables at all, and RLS would answer them with
  // an empty list that reads as "nobody worked today".
  const staffVisible = canRecord

  const [day, movements, orders, staff, roster] = await Promise.all([
    attempt(() => loadDayTotals(supabase, date)),
    attempt(() => loadMovements(supabase, date)),
    attempt<DayOrders>(() => loadDayOrders(supabase, date)),
    staffVisible
      ? attempt<StaffDayLine[]>(() => loadStaffDay(supabase, date))
      : Promise.resolve({ value: [] as StaffDayLine[], error: null }),
    staffVisible
      ? attempt(() => loadRoster(supabase, { includeInactive: false }))
      : Promise.resolve({ value: [], error: null }),
  ])

  // The catalogue check is a nicety on top of rows that are already loaded, so
  // it never gets to fail the page: an unchecked code shows as an ordinary one.
  let rows: MovementRow[] = movements.value ?? []
  if (rows.length > 0) {
    const known = await loadSkuKnowledge(supabase, rows.map((r) => r.sku)).catch(() => null)
    if (known) rows = rows.map((r) => ({ ...r, known: known.get(r.sku) ?? null }))
  }

  const readOnlyReason = user.viewAs
    ? `You are viewing as ${user.fullName}. Nothing can be saved.`
    : canRecord
      ? null
      : 'This day is yours to read. The warehouse manager and the founders keep it.'

  return (
    <div className="mx-auto max-w-6xl space-y-10">
      <PageHeader
        title="Day sheet"
        subtitle={`${formatLongDay(date)}${date === today ? ' · today' : ''}${
          day.value?.recordedByName ? ` · last changed by ${day.value.recordedByName}` : ''
        }`}
      />

      {clamped && <Alert>That day has not happened yet, so this is today&rsquo;s sheet.</Alert>}

      {(day.error || movements.error) && (
        <Alert tone="error">
          {day.error && movements.error
            ? 'This day could not be read.'
            : 'Part of this day could not be read.'}{' '}
          Try reloading; if it keeps failing, tell a developer: {day.error ?? movements.error}
        </Alert>
      )}

      {!day.error && !movements.error && (
        <DaySheet
          key={date}
          date={date}
          today={today}
          totals={day.value?.totals ?? emptyTotals()}
          movements={rows}
          people={(roster.value ?? []).map((s) => s.name)}
          readOnlyReason={readOnlyReason}
          railPanels={
            <>
              <OrdersSection date={date} orders={orders.value} error={orders.error} />
              <StaffSection date={date} lines={staff.value ?? []} visible={staffVisible} error={staff.error} />
            </>
          }
        />
      )}

      {/* When the sheet itself could not be read there is no rail to put these
          in, so they stand on their own rather than disappearing with it. */}
      {(day.error || movements.error) && (
        <>
          <OrdersSection date={date} orders={orders.value} error={orders.error} />
          <StaffSection date={date} lines={staff.value ?? []} visible={staffVisible} error={staff.error} />
        </>
      )}
    </div>
  )
}
