import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  buildDayFill,
  buildPeriodSummary,
  dayKey,
  type Attendance,
  type DayFill,
  type DayRecord,
  type FlagKind,
  type FlagRecord,
  type PeriodSummary,
  type StaffMember,
  type StaffTask,
} from './calc'
import { addDays, eachDate, todayInWarehouse, type IsoDate } from './period'

/**
 * Loading the floor-staff sheet, for the entry screen, the review, and the
 * home screens built on top of them.
 *
 * Everything here takes the caller's RLS-scoped client and adds no authority:
 * a session that cannot read `staff_days` gets an error, not an empty sheet.
 *
 * ERRORS THROW. An empty result here does not mean "nothing"; it means "the
 * manager did not fill the sheet", and a failed query quietly returning [] would
 * paint every day as a gap and put the blame on a person. So a query error is
 * an exception, and the page shows an error instead of a verdict.
 *
 * Dates are the warehouse's calendar dates (see period.ts). `loadPeriodSummary`
 * pages through results because PostgREST caps a response at 1,000 rows and a
 * month of counts for six people on eight tasks can exceed that.
 */

type Client = SupabaseClient

const PAGE = 1000

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isStaffId(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value)
}

interface PgResult<T> {
  data: T[] | null
  error: { message: string } | null
}

async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<PgResult<T>>): Promise<T[]> {
  const out: T[] = []
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await page(offset, offset + PAGE - 1)
    if (error) throw new Error(`Could not load the staff sheet: ${error.message}`)
    const rows = data ?? []
    out.push(...rows)
    if (rows.length < PAGE) return out
  }
}

interface StaffRow {
  id: string
  display_name: string
  started_on: string
  active: boolean
  deactivated_on: string | null
}

const toStaff = (r: StaffRow): StaffMember => ({
  id: r.id,
  name: r.display_name,
  startedOn: r.started_on,
  active: r.active,
  deactivatedOn: r.deactivated_on,
})

/** The roster, active people first then by name. */
export async function loadRoster(
  supabase: Client,
  opts: { includeInactive?: boolean } = {},
): Promise<StaffMember[]> {
  let q = supabase
    .from('floor_staff')
    .select('id, display_name, started_on, active, deactivated_on')
    .order('active', { ascending: false })
    .order('display_name', { ascending: true })
  if (!opts.includeInactive) q = q.eq('active', true)

  const { data, error } = await q
  if (error) throw new Error(`Could not load the roster: ${error.message}`)
  return ((data ?? []) as StaffRow[]).map(toStaff)
}

/** Countable tasks in sheet order. */
export async function loadTasks(
  supabase: Client,
  opts: { includeInactive?: boolean } = {},
): Promise<StaffTask[]> {
  let q = supabase
    .from('staff_tasks')
    .select('code, label, target_per_day, sort_order, active')
    .order('sort_order', { ascending: true })
    .order('code', { ascending: true })
  if (!opts.includeInactive) q = q.eq('active', true)

  const { data, error } = await q
  if (error) throw new Error(`Could not load the task list: ${error.message}`)
  return (
    (data ?? []) as {
      code: string
      label: string
      target_per_day: number | null
      sort_order: number
      active: boolean
    }[]
  ).map((t) => ({
    code: t.code,
    label: t.label,
    targetPerDay: t.target_per_day,
    sortOrder: t.sort_order,
    active: t.active,
  }))
}

/**
 * Every recorded day in `[from, to]`, with its counts and live flags.
 * Optionally one person only.
 */
export async function loadDayRecords(
  supabase: Client,
  range: { from: IsoDate; to: IsoDate },
  opts: { staffId?: string } = {},
): Promise<DayRecord[]> {
  // Every one-person filter goes through here. Written as a match-all filter
  // rather than a conditional `.eq`, because the conditional form sends
  // TypeScript into supabase-js's generics until it gives up.
  //
  // The id is interpolated into a PostgREST filter string, so it must be a
  // uuid and nothing else — a comma or bracket from a URL would otherwise
  // rewrite the filter.
  if (opts.staffId !== undefined && !UUID.test(opts.staffId)) {
    throw new Error('Not a staff id.')
  }
  const staffFilter = opts.staffId ?? null

  const [days, counts, flags] = await Promise.all([
    fetchAll<{
      staff_id: string
      work_date: string
      attendance: Attendance
      note: string | null
      recorded_by: string
      updated_at: string
      app_users: { full_name: string } | { full_name: string }[] | null
    }>((a, b) =>
      supabase
        .from('staff_days')
        .select('staff_id, work_date, attendance, note, recorded_by, updated_at, app_users(full_name)')
        .gte('work_date', range.from)
        .lte('work_date', range.to)
        .or(staffFilter ? `staff_id.eq.${staffFilter}` : 'staff_id.not.is.null')
        .order('work_date')
        .order('staff_id')
        .range(a, b),
    ),
    fetchAll<{ staff_id: string; work_date: string; task_code: string; quantity: number }>((a, b) =>
      supabase
        .from('staff_day_counts')
        .select('staff_id, work_date, task_code, quantity')
        .gte('work_date', range.from)
        .lte('work_date', range.to)
        .or(staffFilter ? `staff_id.eq.${staffFilter}` : 'staff_id.not.is.null')
        .order('work_date')
        .order('staff_id')
        .order('task_code')
        .range(a, b),
    ),
    fetchAll<{
      id: string
      staff_id: string
      work_date: string
      kind: FlagKind
      order_ref: string | null
      note: string | null
      created_at: string
    }>((a, b) =>
      supabase
        .from('staff_quality_flags')
        .select('id, staff_id, work_date, kind, order_ref, note, created_at')
        .gte('work_date', range.from)
        .lte('work_date', range.to)
        .is('removed_at', null)
        .or(staffFilter ? `staff_id.eq.${staffFilter}` : 'staff_id.not.is.null')
        .order('created_at')
        .order('id')
        .range(a, b),
    ),
  ])

  const byKey = new Map<string, DayRecord>()
  for (const d of days) {
    // PostgREST returns an embed as an array when it cannot prove to-one.
    const user = Array.isArray(d.app_users) ? d.app_users[0] : d.app_users
    byKey.set(dayKey(d.staff_id, d.work_date), {
      staffId: d.staff_id,
      date: d.work_date,
      attendance: d.attendance,
      note: d.note,
      recordedBy: d.recorded_by,
      recordedByName: user?.full_name ?? null,
      updatedAt: d.updated_at,
      counts: {},
      flags: [],
    })
  }

  for (const c of counts) {
    const r = byKey.get(dayKey(c.staff_id, c.work_date))
    // Zeroed counts are kept in the table for history; they are not work.
    if (r && c.quantity > 0) r.counts[c.task_code] = c.quantity
  }

  for (const f of flags) {
    const r = byKey.get(dayKey(f.staff_id, f.work_date))
    const flag: FlagRecord = {
      id: f.id,
      staffId: f.staff_id,
      date: f.work_date,
      kind: f.kind,
      orderRef: f.order_ref,
      note: f.note,
      createdAt: f.created_at,
    }
    r?.flags.push(flag)
  }

  return [...byKey.values()]
}

export interface SheetStatus {
  date: IsoDate
  /** Active people expected on the sheet that day (0 on a non-working day). */
  expected: number
  /** How many of them are recorded. */
  recorded: number
  missing: { id: string; name: string }[]
  state: DayFill['state']
}

/**
 * Whether the sheet for `date` (default: the warehouse's today) is filled in.
 *
 * For the warehouse home ("3 of 6 logged today") and the founders' dashboard.
 * Two small queries rather than `loadDayRecords`, because a home screen asks
 * this on every load and needs neither counts nor flags.
 */
export async function loadTodaySheetStatus(
  supabase: Client,
  date: IsoDate = todayInWarehouse(),
): Promise<SheetStatus> {
  const [staff, recorded] = await Promise.all([
    loadRoster(supabase, { includeInactive: true }),
    supabase.from('staff_days').select('staff_id').eq('work_date', date),
  ])
  if (recorded.error) throw new Error(`Could not load the staff sheet: ${recorded.error.message}`)

  const keys = new Set(((recorded.data ?? []) as { staff_id: string }[]).map((r) => dayKey(r.staff_id, date)))
  const fill = buildDayFill(staff, keys, date)
  return {
    date,
    expected: fill.expected,
    recorded: fill.recorded,
    missing: fill.missing,
    state: fill.state,
  }
}

/**
 * How full the sheet is for each of the last `days` days, ending `today`
 * inclusive and oldest first. The entry screen's "what have I not done" strip.
 */
export async function loadRecentFill(
  supabase: Client,
  today: IsoDate = todayInWarehouse(),
  days = 7,
): Promise<DayFill[]> {
  const from = addDays(today, -(days - 1))
  const [staff, recorded] = await Promise.all([
    loadRoster(supabase, { includeInactive: true }),
    fetchAll<{ staff_id: string; work_date: string }>((a, b) =>
      supabase
        .from('staff_days')
        .select('staff_id, work_date')
        .gte('work_date', from)
        .lte('work_date', today)
        .order('work_date')
        .order('staff_id')
        .range(a, b),
    ),
  ])
  const keys = new Set(recorded.map((r) => dayKey(r.staff_id, r.work_date)))
  return eachDate(from, today).map((d) => buildDayFill(staff, keys, d))
}

/**
 * Everything the founders' review shows for a period: per-person totals
 * against attendance-adjusted targets, the day-by-person grid with gaps
 * marked, and how many days the sheet was actually filled.
 *
 * `opts.staffId` narrows it to one person for the drill-down; the day fill is
 * then that person's alone.
 */
export async function loadPeriodSummary(
  supabase: Client,
  range: { from: IsoDate; to: IsoDate },
  opts: { staffId?: string } = {},
): Promise<PeriodSummary & { records: DayRecord[] }> {
  const [allStaff, tasks, records] = await Promise.all([
    loadRoster(supabase, { includeInactive: true }),
    loadTasks(supabase, { includeInactive: true }),
    loadDayRecords(supabase, range, opts),
  ])
  const staff = opts.staffId ? allStaff.filter((s) => s.id === opts.staffId) : allStaff
  return { ...buildPeriodSummary({ from: range.from, to: range.to, staff, tasks, records }), records }
}
