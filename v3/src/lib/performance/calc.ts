/**
 * The arithmetic of the floor-staff review, as pure functions.
 *
 * Pure so that it can be tested without a database, and because every number
 * here ends up next to a person's name in front of the founders. A wrong
 * percentage throws no error; it just makes somebody look slow.
 *
 * THE TWO RULES EVERYTHING FOLLOWS
 *
 *   1. Attendance scales the target. A half day is half a target; absence and
 *      leave are no target at all. Nobody is measured against a day they were
 *      not there for.
 *   2. An unrecorded day is not a zero. It contributes nothing to output AND
 *      nothing to target, and is counted separately as a gap — so a week the
 *      manager skipped two days of shows as "2 days not recorded", never as a
 *      person who did 60% of their work.
 */
import { eachDate, isWorkingDay, type IsoDate } from './period'

export type Attendance = 'present' | 'half_day' | 'absent' | 'leave'
export type FlagKind = 'wrong_item' | 'damage' | 'repack' | 'other'

export const ATTENDANCE: { value: Attendance; label: string; short: string }[] = [
  { value: 'present', label: 'Present', short: 'P' },
  { value: 'half_day', label: 'Half day', short: '½' },
  { value: 'absent', label: 'Absent', short: 'A' },
  { value: 'leave', label: 'Leave', short: 'L' },
]

export const FLAG_KINDS: { value: FlagKind; label: string }[] = [
  { value: 'wrong_item', label: 'Wrong item' },
  { value: 'damage', label: 'Damage' },
  { value: 'repack', label: 'Re-pack' },
  { value: 'other', label: 'Other' },
]

/** How much of a day's target a day of this attendance carries. */
export const ATTENDANCE_WEIGHT: Record<Attendance, number> = {
  present: 1,
  half_day: 0.5,
  absent: 0,
  leave: 0,
}

/** Whether a person with this attendance can have work counted at all. */
export function canHaveWork(attendance: Attendance | null): boolean {
  return attendance === 'present' || attendance === 'half_day'
}

export interface StaffMember {
  id: string
  name: string
  startedOn: IsoDate
  active: boolean
  deactivatedOn: IsoDate | null
}

export interface StaffTask {
  code: string
  label: string
  /** Units in a full day of only this task. Null: no agreed target. */
  targetPerDay: number | null
  sortOrder: number
  active: boolean
}

export interface FlagRecord {
  id: string
  staffId: string
  date: IsoDate
  kind: FlagKind
  orderRef: string | null
  note: string | null
  createdAt: string
}

export interface DayRecord {
  staffId: string
  date: IsoDate
  attendance: Attendance
  note: string | null
  recordedBy: string
  recordedByName: string | null
  updatedAt: string
  /** task code → quantity. Tasks with no row are absent, not zero. */
  counts: Record<string, number>
  /** Live flags only; withdrawn ones are not loaded into a summary. */
  flags: FlagRecord[]
}

/**
 * Whether `staff` is expected on the sheet for `date`: employed that day and
 * the day is a working day. Deactivation takes effect FROM `deactivatedOn` —
 * the day somebody is marked as having left is not a day they are missing.
 */
export function isExpected(staff: StaffMember, date: IsoDate): boolean {
  if (date < staff.startedOn) return false
  if (staff.deactivatedOn && date >= staff.deactivatedOn) return false
  return isWorkingDay(date)
}

/** target × attendance-days, or null when the task has no target. */
export function adjustedTarget(targetPerDay: number | null, attendanceDays: number): number | null {
  if (targetPerDay === null || targetPerDay <= 0) return null
  return targetPerDay * attendanceDays
}

/** actual ÷ target, or null when there is nothing meaningful to divide by. */
export function completion(actual: number, target: number | null): number | null {
  if (target === null || target <= 0) return null
  return actual / target
}

/** "84%", or "—" when there is no ratio. Rounded, because these are rough counts. */
export function formatPercent(ratio: number | null): string {
  if (ratio === null || !Number.isFinite(ratio)) return '—'
  return `${Math.round(ratio * 100)}%`
}

/** "4.5" or "4" — attendance days are only ever whole or half. */
export function formatDays(days: number): string {
  return Number.isInteger(days) ? String(days) : days.toFixed(1)
}

/**
 * Output across mixed tasks, expressed in full-day targets.
 *
 * A person who picks 130 and packs half a day's worth has done 1.0 "target
 * days" of work, even though neither task alone reaches its target. Comparing
 * per-task totals against per-task targets would call that person 50% on
 * both; this calls them 100% for the day, which is what happened. Only tasks
 * with a target contribute; untargeted units are returned separately so the
 * screen can say they exist rather than silently dropping them.
 */
export function outputIndex(
  counts: Record<string, number>,
  targets: Record<string, number | null>,
  attendanceDays: number,
): { targetDays: number; ratio: number | null; untargetedUnits: number } {
  let targetDays = 0
  let untargetedUnits = 0
  let anyTargeted = false

  for (const [code, quantity] of Object.entries(counts)) {
    const target = targets[code] ?? null
    if (target !== null && target > 0) {
      targetDays += quantity / target
      anyTargeted = true
    } else {
      untargetedUnits += quantity
    }
  }

  // No targeted work at all, or no attendance to measure against: say nothing
  // rather than print 0%, which would read as a verdict.
  const ratio = anyTargeted && attendanceDays > 0 ? targetDays / attendanceDays : null
  return { targetDays, ratio, untargetedUnits }
}

// ---------------------------------------------------------------------------
// Sheet fill: which days were recorded
// ---------------------------------------------------------------------------

export interface DayFill {
  date: IsoDate
  working: boolean
  /** People expected that day. Zero on a Sunday or before anyone started. */
  expected: number
  /** Expected people with a record. */
  recorded: number
  /** Names of expected people without a record. */
  missing: { id: string; name: string }[]
  /** Anyone recorded at all, expected or not (a Sunday that was worked). */
  anyRecorded: boolean
  state: 'complete' | 'partial' | 'empty' | 'not_expected'
}

export function buildDayFill(
  staff: StaffMember[],
  recordedKeys: ReadonlySet<string>,
  date: IsoDate,
): DayFill {
  const expectedStaff = staff.filter((s) => isExpected(s, date))
  const missing = expectedStaff
    .filter((s) => !recordedKeys.has(dayKey(s.id, date)))
    .map((s) => ({ id: s.id, name: s.name }))
  const recorded = expectedStaff.length - missing.length
  const anyRecorded = staff.some((s) => recordedKeys.has(dayKey(s.id, date)))

  let state: DayFill['state']
  if (expectedStaff.length === 0) state = 'not_expected'
  else if (missing.length === 0) state = 'complete'
  else if (recorded === 0) state = 'empty'
  else state = 'partial'

  return {
    date,
    working: isWorkingDay(date),
    expected: expectedStaff.length,
    recorded,
    missing,
    anyRecorded,
    state,
  }
}

export function dayKey(staffId: string, date: IsoDate): string {
  return `${staffId}|${date}`
}

// ---------------------------------------------------------------------------
// The period summary
// ---------------------------------------------------------------------------

export type Cell =
  | { kind: 'recorded'; attendance: Attendance; units: number; flags: number; note: boolean }
  | { kind: 'missing' }
  | { kind: 'not_expected' }

export interface TaskResult {
  code: string
  label: string
  total: number
  /** Target for this period, already scaled by attendance. Null: no target. */
  target: number | null
  completion: number | null
}

export interface PersonSummary {
  staff: StaffMember
  /** Days this person should have been on the sheet. */
  expectedDays: number
  /** Days they were on the sheet (including any non-working day that was recorded). */
  recordedDays: number
  /** Expected days with no record — the manager's gaps, not the person's. */
  unrecordedDates: IsoDate[]
  attendance: Record<Attendance, number>
  /** present + 0.5 × half_day. The multiplier for every target. */
  attendanceDays: number
  tasks: TaskResult[]
  output: { targetDays: number; ratio: number | null; untargetedUnits: number }
  flags: { total: number; byKind: Record<FlagKind, number> }
  cells: Record<IsoDate, Cell>
}

export interface PeriodSummary {
  from: IsoDate
  to: IsoDate
  dates: DayFill[]
  tasks: StaffTask[]
  people: PersonSummary[]
  totals: {
    /** Dates on which at least one person was expected. */
    expectedDates: number
    completeDates: number
    /** Expected dates with nobody recorded at all. */
    emptyDates: IsoDate[]
    /** Expected dates with some, but not all, recorded. */
    partialDates: IsoDate[]
    flags: number
  }
}

const emptyAttendance = (): Record<Attendance, number> => ({
  present: 0,
  half_day: 0,
  absent: 0,
  leave: 0,
})

const emptyFlagKinds = (): Record<FlagKind, number> => ({
  wrong_item: 0,
  damage: 0,
  repack: 0,
  other: 0,
})

/**
 * Folds a period's records into what the review shows.
 *
 * `staff` should include inactive people: somebody who left mid-month still
 * worked the first half of it. A person with no expected days and no records
 * in the period is dropped, so last year's leavers do not fill the table.
 */
export function buildPeriodSummary(input: {
  from: IsoDate
  to: IsoDate
  staff: StaffMember[]
  tasks: StaffTask[]
  records: DayRecord[]
}): PeriodSummary {
  const { from, to, staff, tasks, records } = input
  const dates = eachDate(from, to)

  const byKey = new Map<string, DayRecord>()
  for (const r of records) {
    if (r.date >= from && r.date <= to) byKey.set(dayKey(r.staffId, r.date), r)
  }
  const keys = new Set(byKey.keys())

  const fills = dates.map((d) => buildDayFill(staff, keys, d))
  const targets: Record<string, number | null> = Object.fromEntries(
    tasks.map((t) => [t.code, t.targetPerDay]),
  )

  const people: PersonSummary[] = []
  let flagTotal = 0

  for (const s of staff) {
    const attendance = emptyAttendance()
    const totals: Record<string, number> = {}
    const byKind = emptyFlagKinds()
    const cells: Record<IsoDate, Cell> = {}
    const unrecordedDates: IsoDate[] = []
    let expectedDays = 0
    let recordedDays = 0
    let flags = 0

    for (const d of dates) {
      const expected = isExpected(s, d)
      if (expected) expectedDays++

      const r = byKey.get(dayKey(s.id, d))
      if (!r) {
        cells[d] = expected ? { kind: 'missing' } : { kind: 'not_expected' }
        if (expected) unrecordedDates.push(d)
        continue
      }

      recordedDays++
      attendance[r.attendance]++
      let units = 0
      for (const [code, q] of Object.entries(r.counts)) {
        totals[code] = (totals[code] ?? 0) + q
        units += q
      }
      for (const f of r.flags) byKind[f.kind]++
      flags += r.flags.length
      cells[d] = {
        kind: 'recorded',
        attendance: r.attendance,
        units,
        flags: r.flags.length,
        note: Boolean(r.note),
      }
    }

    if (expectedDays === 0 && recordedDays === 0) continue

    const attendanceDays = attendance.present + 0.5 * attendance.half_day
    flagTotal += flags

    people.push({
      staff: s,
      expectedDays,
      recordedDays,
      unrecordedDates,
      attendance,
      attendanceDays,
      tasks: tasks
        // A retired task still shows if somebody did it in this period.
        .filter((t) => t.active || (totals[t.code] ?? 0) > 0)
        .map((t) => {
          const total = totals[t.code] ?? 0
          const target = adjustedTarget(t.targetPerDay, attendanceDays)
          return { code: t.code, label: t.label, total, target, completion: completion(total, target) }
        }),
      output: outputIndex(totals, targets, attendanceDays),
      flags: { total: flags, byKind },
      cells,
    })
  }

  const expectedFills = fills.filter((f) => f.state !== 'not_expected')

  return {
    from,
    to,
    dates: fills,
    tasks,
    people,
    totals: {
      expectedDates: expectedFills.length,
      completeDates: expectedFills.filter((f) => f.state === 'complete').length,
      emptyDates: expectedFills.filter((f) => f.state === 'empty').map((f) => f.date),
      partialDates: expectedFills.filter((f) => f.state === 'partial').map((f) => f.date),
      flags: flagTotal,
    },
  }
}
