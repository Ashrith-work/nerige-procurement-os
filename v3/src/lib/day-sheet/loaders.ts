import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { IsoDate } from '@/lib/performance/period'
import { loadDayRecords, loadRoster, loadTasks } from '@/lib/performance/summary'
import { ATTENDANCE, canHaveWork, type Attendance } from '@/lib/performance/calc'
import {
  MOVEMENTS,
  TOTAL_COLUMNS,
  emptyTotals,
  type DayOrders,
  type DayTotals,
  type MovementKind,
  type MovementRow,
} from './calc'

/**
 * Reading the warehouse day sheet.
 *
 * Everything here takes the caller's RLS-scoped client and adds no authority of
 * its own: a session that may not read `warehouse_movements` gets an error, not
 * an empty day.
 *
 * ERRORS THROW, every one of them. This screen is a reconciliation — the whole
 * reason it exists is to show a number that does not add up — so a query that
 * failed and returned zero would be indistinguishable from a day on which
 * nothing went wrong. That is the one failure this screen must never have. The
 * page catches these and says the section could not be read.
 *
 * The exception is deliberate and lives in the database, not here:
 * `warehouse_day_orders` answers `board_connected = false` where the dispatch
 * schema is absent, which is a fact about the installation rather than an
 * error, and the orders section says so in words.
 */

type Client = SupabaseClient

// ---------------------------------------------------------------------------
// The day's counted totals
// ---------------------------------------------------------------------------

export interface DaySheetRecord {
  totals: DayTotals
  /** Null until somebody has saved this day at all. */
  updatedAt: string | null
  recordedByName: string | null
}

interface DayRow {
  cec_out: number
  cec_back: number
  ai_out: number
  ai_back: number
  video_out: number
  video_back: number
  video_orders: number
  note: string | null
  updated_at: string
  app_users: { full_name: string } | { full_name: string }[] | null
}

const DAY_COLUMNS =
  'cec_out, cec_back, ai_out, ai_back, video_out, video_back, video_orders, note, updated_at, app_users(full_name)'

/** The three boxes across the top of each movement, and the note under the page. */
export async function loadDayTotals(supabase: Client, date: IsoDate): Promise<DaySheetRecord> {
  const { data, error } = await supabase
    .from('warehouse_days')
    .select(DAY_COLUMNS)
    .eq('work_date', date)
    .maybeSingle()

  if (error) throw new Error(`Could not read the day's counts: ${error.message}`)
  if (!data) return { totals: emptyTotals(), updatedAt: null, recordedByName: null }

  const row = data as unknown as DayRow
  // PostgREST returns an embed as an array when it cannot prove the relation is
  // to-one. `recorded_by` is a plain FK, so there is at most one.
  const user = Array.isArray(row.app_users) ? row.app_users[0] : row.app_users

  const totals = emptyTotals()
  for (const m of MOVEMENTS) {
    const cols = TOTAL_COLUMNS[m.kind]
    totals.out[m.kind] = Number(row[cols.out as keyof DayRow] ?? 0)
    totals.back[m.kind] = Number(row[cols.back as keyof DayRow] ?? 0)
  }
  totals.videoOrders = Number(row.video_orders ?? 0)
  totals.note = row.note ?? ''

  return { totals, updatedAt: row.updated_at, recordedByName: user?.full_name ?? null }
}

// ---------------------------------------------------------------------------
// The sarees themselves
// ---------------------------------------------------------------------------

/** Exported so the action that inserts a row can map its own RETURNING. */
export interface MovementDbRow {
  id: string
  kind: MovementKind
  sku: string
  went_out: boolean
  came_back: boolean
  sold_offline: boolean
  bill_no: string | null
  reason: string | null
  who: string | null
}

const MOVEMENT_COLUMNS = 'id, kind, sku, went_out, came_back, sold_offline, bill_no, reason, who, created_at'

/**
 * Every saree written down for this day, oldest line first.
 *
 * Entry order, not alphabetical and not grouped by state: the manager reads
 * back down the list they typed, and a row that jumped somewhere else the
 * moment it was ticked would lose their place. The three lists the notebook
 * draws are computed from these rows on screen — see `splitMovements`.
 */
export async function loadMovements(supabase: Client, date: IsoDate): Promise<MovementRow[]> {
  const { data, error } = await supabase
    .from('warehouse_movements')
    .select(MOVEMENT_COLUMNS)
    .eq('work_date', date)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })

  if (error) throw new Error(`Could not read the day's sarees: ${error.message}`)
  return ((data ?? []) as unknown as MovementDbRow[]).map(toMovementRow)
}

export function toMovementRow(r: MovementDbRow): MovementRow {
  return {
    id: r.id,
    kind: r.kind,
    sku: r.sku,
    wentOut: r.went_out,
    cameBack: r.came_back,
    soldOffline: r.sold_offline,
    billNo: r.bill_no ?? '',
    reason: r.reason ?? '',
    who: r.who ?? '',
    known: null,
  }
}

/**
 * Which of these codes the catalogue knows.
 *
 * Through `lookup_products`, never through `products`: migration 036 grants the
 * warehouse manager orders, order lines and vendors, and nothing else, so a
 * direct read would return no rows and paint every saree on the sheet as
 * unknown. The SECURITY DEFINER function is what `app.can_lookup()` opens to
 * every staff role.
 *
 * One call per distinct code, because the function searches for one fragment at
 * a time. That is the cost of not widening a grant: a day's sheet is a few
 * dozen sarees, so a handful of calls at a time keeps it well under a second
 * without opening a connection per row.
 *
 * A failed check yields `null`, not `false`. "We could not ask" and "the
 * catalogue has never heard of this" look identical on screen otherwise, and
 * only one of them is a reason to go and look for a saree.
 */
export async function loadSkuKnowledge(
  supabase: Client,
  skus: readonly string[],
): Promise<Map<string, boolean | null>> {
  const distinct = [...new Set(skus)]
  const known = new Map<string, boolean | null>()
  const BATCH = 8

  for (let i = 0; i < distinct.length; i += BATCH) {
    const batch = distinct.slice(i, i + BATCH)
    const answers = await Promise.all(batch.map((sku) => lookupExact(supabase, sku)))
    batch.forEach((sku, n) => known.set(sku, answers[n]))
  }

  return known
}

/** True when the catalogue holds this exact code; null when the check failed. */
export async function lookupExact(supabase: Client, sku: string): Promise<boolean | null> {
  // The function matches on a fragment, so a hit has to be confirmed against
  // the whole code — "PGW-1" would otherwise mark itself known off "PGW-101".
  const { data, error } = await supabase.rpc('lookup_products', { p_query: sku, p_limit: 20 })
  if (error) return null
  return ((data ?? []) as { sku: string }[]).some((r) => r.sku.toLowerCase() === sku.toLowerCase())
}

// ---------------------------------------------------------------------------
// The orders half
// ---------------------------------------------------------------------------

interface OrdersDbRow {
  orders_received: number
  domestic: number
  international: number
  saree_only: number
  service_orders: number
  stitched_orders: number
  offline_orders: number
  can_ship_today: number
  dispatched: number
  still_to_go: number
  open_till_date: number
  oldest_open: string | null
  board_connected: boolean
}

/**
 * The orders section, counted from the dispatch board.
 *
 * Nothing here is typed and nothing here is editable. The function returns
 * counts only — no order number, no customer, no address — which is why it can
 * be opened to every staff role while the `dispatch` schema itself stays off
 * PostgREST's exposed list.
 */
export async function loadDayOrders(supabase: Client, date: IsoDate): Promise<DayOrders> {
  const { data, error } = await supabase.rpc('warehouse_day_orders', { p_date: date })
  if (error) throw new Error(`Could not count the day's orders: ${error.message}`)

  const rows = (data ?? []) as OrdersDbRow[]
  const r = rows[0]
  // The function is declared `returns table` and always emits exactly one row.
  // No row means something answered in its place, and a screen full of zeros is
  // the wrong way to find that out.
  if (!r) throw new Error('The orders for this day came back empty, which the board never does.')

  return {
    ordersReceived: r.orders_received,
    domestic: r.domestic,
    international: r.international,
    sareeOnly: r.saree_only,
    serviceOrders: r.service_orders,
    stitchedOrders: r.stitched_orders,
    offlineOrders: r.offline_orders,
    canShipToday: r.can_ship_today,
    dispatched: r.dispatched,
    stillToGo: r.still_to_go,
    openTillDate: r.open_till_date,
    oldestOpen: r.oldest_open,
    boardConnected: r.board_connected,
  }
}

// ---------------------------------------------------------------------------
// The staff work log, read off the sheet that already exists
// ---------------------------------------------------------------------------

export interface StaffDayLine {
  id: string
  name: string
  attendance: Attendance | null
  attendanceLabel: string
  note: string | null
  counts: { code: string; label: string; quantity: number }[]
  total: number
  flags: number
}

/**
 * Who worked, and on what, on this day.
 *
 * Built from `loadRoster` / `loadTasks` / `loadDayRecords` rather than from a
 * query of its own: the staff sheet has one reading, and a second query here
 * that filtered or joined a shade differently would put two different answers
 * to "how many did Lakshmi pick today" on two screens of the same application.
 *
 * Read-only on this page. The sheet is filled in at /warehouse/staff, and this
 * is the day sheet quoting it.
 */
export async function loadStaffDay(supabase: Client, date: IsoDate): Promise<StaffDayLine[]> {
  const [roster, tasks, records] = await Promise.all([
    loadRoster(supabase, { includeInactive: true }),
    loadTasks(supabase, { includeInactive: true }),
    loadDayRecords(supabase, { from: date, to: date }),
  ])

  const label = new Map(tasks.map((t) => [t.code, t.label]))
  const order = new Map(tasks.map((t, i) => [t.code, i]))
  const recordFor = new Map(records.map((r) => [r.staffId, r]))

  return roster
    // Anyone employed that day, plus anyone already recorded on it — a record
    // outlives a later deactivation, exactly as on the sheet itself.
    .filter(
      (s) =>
        recordFor.has(s.id) ||
        (s.startedOn <= date && (s.deactivatedOn === null || s.deactivatedOn > date)),
    )
    .map((s) => {
      const r = recordFor.get(s.id)
      const counts = Object.entries(r?.counts ?? {})
        .filter(([, qty]) => qty > 0)
        .map(([code, quantity]) => ({ code, label: label.get(code) ?? code, quantity }))
        .sort((a, b) => (order.get(a.code) ?? 99) - (order.get(b.code) ?? 99))

      return {
        id: s.id,
        name: s.name,
        attendance: r?.attendance ?? null,
        attendanceLabel:
          r?.attendance === undefined || r.attendance === null
            ? 'Not recorded'
            : (ATTENDANCE.find((a) => a.value === r.attendance)?.label ?? r.attendance),
        note: r?.note ?? null,
        counts: canHaveWork(r?.attendance ?? null) ? counts : [],
        total: counts.reduce((sum, c) => sum + c.quantity, 0),
        flags: r?.flags.length ?? 0,
      }
    })
}
