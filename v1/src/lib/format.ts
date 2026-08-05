/**
 * Display formatting.
 *
 * Centralised because a number that reads differently on two screens is a
 * number the team stops trusting — and because Indian digit grouping is not
 * what a default `toLocaleString()` produces. ₹1,50,000 is correct here;
 * ₹150,000 looks foreign to everyone who has to check it.
 */

const INR = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
})

const INR_EXACT = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/**
 * Money for reading at a glance — no paise.
 *
 * Amounts arrive from PostgREST as strings, because JavaScript numbers cannot
 * hold `numeric` exactly. They are parsed here for display only; every sum that
 * matters is computed in the database.
 */
export function money(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  const n = typeof value === 'string' ? Number(value) : value
  return Number.isFinite(n) ? INR.format(n) : '—'
}

/** Money for a document that has to reconcile against a paper bill. */
export function moneyExact(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  const n = typeof value === 'string' ? Number(value) : value
  return Number.isFinite(n) ? INR_EXACT.format(n) : '—'
}

const DATE = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

const DATE_TIME = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
})

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—'
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? '—' : DATE.format(d)
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—'
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? '—' : DATE_TIME.format(d)
}

/** Today in the ISO form a `<input type="date">` and Postgres both accept. */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Whole days from today until `value`. Negative means overdue.
 *
 * Compared at date granularity, not by millisecond difference: an order due
 * "today at 00:00" is due today, not eleven hours overdue.
 */
export function daysUntil(value: string | Date | null | undefined): number | null {
  if (!value) return null
  const target = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(target.getTime())) return null

  const startOfDay = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
  return Math.round((startOfDay(target) - startOfDay(new Date())) / 86_400_000)
}

/**
 * Hours elapsed since `value`, or null if there is no timestamp.
 *
 * Lives here with the other now-relative helpers rather than being inlined into
 * a page. Reading the clock inside a component body is impure — the same render
 * would produce a different answer a moment later — so every comparison against
 * "now" is made through this module.
 */
export function hoursSince(value: string | Date | null | undefined): number | null {
  if (!value) return null
  const then = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(then.getTime())) return null
  return (Date.now() - then.getTime()) / 3_600_000
}

/** "in 3 days" / "2 days late" / "today" — phrased for a deadline, not a clock. */
export function dueLabel(value: string | Date | null | undefined): string {
  const days = daysUntil(value)
  if (days === null) return 'No date set'
  if (days === 0) return 'Due today'
  if (days > 0) return days === 1 ? 'Due tomorrow' : `Due in ${days} days`
  return days === -1 ? '1 day late' : `${Math.abs(days)} days late`
}

export function pluralise(n: number, singular: string, plural = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : plural}`
}

/** Turns `partially_received` into `Partially received` for display. */
export function humanise(value: string): string {
  const spaced = value.replace(/_/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}
