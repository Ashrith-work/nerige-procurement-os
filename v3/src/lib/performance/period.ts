/**
 * Calendar arithmetic for the floor-staff sheet.
 *
 * Every date here is an ISO `YYYY-MM-DD` string, never a `Date`. A work day is
 * a calendar date in the warehouse, not an instant: turning "2026-09-15" into
 * a `Date` puts it at midnight UTC, which is 05:30 in Bengaluru, and one
 * `toLocaleDateString()` on a server in a different zone later it is the 14th.
 * Strings compare correctly, sort correctly and survive a URL.
 *
 * Arithmetic that genuinely needs a Date (adding days, finding a weekday) does
 * it in UTC on both ends, where no daylight saving or offset can move it.
 *
 * No imports, no server-only: the unit tests load this file directly.
 */

export type IsoDate = string

/** The warehouse's zone. `app.staff_today()` in migration 034 uses the same. */
export const WAREHOUSE_TIME_ZONE = 'Asia/Kolkata'

/**
 * Today and the 7 days before it are the manager's to change. Mirrors
 * `app.can_edit_staff_day()`; the database is the enforcement, this is so the
 * screen can say a day is closed before a save is refused.
 */
export const EDIT_WINDOW_DAYS = 7

/**
 * Days the warehouse is not expected to be recorded. Sunday (0).
 *
 * ASSUMPTION, to be confirmed: the floor does not work Sundays. A Sunday left
 * blank is therefore not shown as a missed sheet; a Sunday that IS filled in
 * counts normally. If the warehouse works a six-day week that includes Sunday
 * and closes another day, this is the one line to change.
 */
export const NON_WORKING_WEEKDAYS: readonly number[] = [0]

/** The longest custom period the review will load, so a typo cannot ask for a decade. */
export const MAX_PERIOD_DAYS = 93

const ISO = /^\d{4}-\d{2}-\d{2}$/

export function isIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== 'string' || !ISO.test(value)) return false
  const d = new Date(`${value}T00:00:00Z`)
  // Rejects 2026-02-30, which the regex admits and Date silently rolls over.
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
}

/** The warehouse's calendar date at `now`. */
export function todayInWarehouse(now: Date = new Date()): IsoDate {
  // en-CA formats as YYYY-MM-DD, which is the whole reason for choosing it.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: WAREHOUSE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

function toUtc(date: IsoDate): Date {
  return new Date(`${date}T00:00:00Z`)
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const d = toUtc(date)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / 86_400_000)
}

/** Every date from `from` to `to` inclusive, oldest first. Empty if reversed. */
export function eachDate(from: IsoDate, to: IsoDate): IsoDate[] {
  const out: IsoDate[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d)
  return out
}

/** 0 = Sunday … 6 = Saturday. */
export function weekday(date: IsoDate): number {
  return toUtc(date).getUTCDay()
}

export function isWorkingDay(date: IsoDate): boolean {
  return !NON_WORKING_WEEKDAYS.includes(weekday(date))
}

/** The Monday on or before `date`. */
export function startOfWeek(date: IsoDate): IsoDate {
  const offset = (weekday(date) + 6) % 7
  return addDays(date, -offset)
}

export function startOfMonth(date: IsoDate): IsoDate {
  return `${date.slice(0, 8)}01`
}

/** Whether a warehouse manager may still change `date`. Admin: any date ≤ today. */
export function isWithinEditWindow(date: IsoDate, today: IsoDate): boolean {
  return date <= today && daysBetween(date, today) <= EDIT_WINDOW_DAYS
}

export type PeriodPreset = 'this_week' | 'last_week' | 'this_month' | 'last_month' | 'custom'

export const PERIOD_PRESETS: { value: Exclude<PeriodPreset, 'custom'>; label: string }[] = [
  { value: 'this_week', label: 'This week' },
  { value: 'last_week', label: 'Last week' },
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
]

export interface Period {
  preset: PeriodPreset
  from: IsoDate
  to: IsoDate
}

/**
 * A period from URL parameters.
 *
 * Never reaches past today: a period that includes tomorrow would show
 * tomorrow as an unfilled sheet. A custom range that is reversed is swapped
 * rather than refused, and one longer than MAX_PERIOD_DAYS keeps its end and
 * loses its start — the recent end is the part anybody is asking about.
 * Anything unreadable falls back to this week.
 */
export function resolvePeriod(
  params: { preset?: string; from?: string; to?: string },
  today: IsoDate,
): Period {
  const preset = params.preset as PeriodPreset | undefined

  switch (preset) {
    case 'last_week': {
      const from = addDays(startOfWeek(today), -7)
      return { preset, from, to: addDays(from, 6) }
    }
    case 'this_month':
      return { preset, from: startOfMonth(today), to: today }
    case 'last_month': {
      const to = addDays(startOfMonth(today), -1)
      return { preset, from: startOfMonth(to), to }
    }
    case 'custom': {
      if (!isIsoDate(params.from) || !isIsoDate(params.to)) break
      let from = params.from < params.to ? params.from : params.to
      let to = params.from < params.to ? params.to : params.from
      if (to > today) to = today
      if (from > to) from = to
      if (daysBetween(from, to) + 1 > MAX_PERIOD_DAYS) from = addDays(to, -(MAX_PERIOD_DAYS - 1))
      return { preset, from, to }
    }
  }

  return { preset: 'this_week', from: startOfWeek(today), to: today }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** "Mon 15 Sep". Formatted by hand so the server's locale and zone cannot change it. */
export function formatDay(date: IsoDate): string {
  return `${WEEKDAYS[weekday(date)]} ${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]}`
}

/** "15 Sep 2026". */
export function formatLongDay(date: IsoDate): string {
  return `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`
}

export function weekdayInitial(date: IsoDate): string {
  return WEEKDAYS[weekday(date)].slice(0, 2)
}
