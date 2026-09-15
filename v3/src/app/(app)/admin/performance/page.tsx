import Link from 'next/link'
import { requireStaffReview } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { Card, EmptyState, PageHeader, cn } from '@/components/ui/primitives'
import { loadPeriodSummary } from '@/lib/performance/summary'
import { formatDays, formatPercent, type PersonSummary } from '@/lib/performance/calc'
import {
  formatDay,
  formatLongDay,
  resolvePeriod,
  todayInWarehouse,
  weekdayInitial,
} from '@/lib/performance/period'
import { PeriodPicker, periodQuery } from './period-picker'
import { GridCell, Legend } from './cells'

export const metadata = { title: 'Staff performance · Nerige' }

function currentPeriod(params: { preset?: string; from?: string; to?: string }) {
  const today = todayInWarehouse()
  return { today, period: resolvePeriod(params, today) }
}

/** Colour for a completion ratio. Deliberately coarse: these are rough counts. */
function completionTone(ratio: number | null): string {
  if (ratio === null) return 'text-stone-400'
  if (ratio >= 0.9) return 'text-emerald-700'
  if (ratio >= 0.7) return 'text-amber-700'
  return 'text-red-700'
}

/**
 * The founders' review of the warehouse floor.
 *
 * Read in three layers, top to bottom, and the order is the argument:
 *
 *   1. Was the sheet filled? Every number below depends on it, so it comes
 *      first, and unfilled days are named rather than averaged away.
 *   2. Per person: attendance, output against a target already scaled for the
 *      days they were actually there, and quality flags.
 *   3. The day-by-person grid, where a gap looks like a gap.
 *
 * The counts are the manager's rough daily numbers, not timings, and the page
 * says so — a founder reading 84% as a stopwatch reading would be reading
 * something this system does not measure.
 */
export default async function StaffPerformancePage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; from?: string; to?: string }>
}) {
  const params = await searchParams
  await requireStaffReview()
  const { today, period } = currentPeriod(params)
  const supabase = await createClient()
  const summary = await loadPeriodSummary(supabase, period)
  const q = periodQuery(period)

  // Only tasks that carry information this period: done by someone, or with a
  // target set. Eight mostly-empty columns hide the two that matter.
  const shownTasks = summary.tasks.filter(
    (t) => t.targetPerDay !== null || summary.people.some((p) => p.tasks.some((x) => x.code === t.code && x.total > 0)),
  )

  const { totals } = summary
  const gaps = [...totals.emptyDates, ...totals.partialDates].sort()

  return (
    <div className="space-y-6">
      <PageHeader
        title="Staff performance"
        subtitle={`${formatLongDay(period.from)} – ${formatLongDay(period.to)}`}
        action={
          <Link
            href="/admin/performance/targets"
            className="inline-flex min-h-11 items-center rounded-lg border border-stone-300 bg-white px-3 text-sm text-stone-700 hover:bg-stone-50"
          >
            Targets
          </Link>
        }
      />

      <PeriodPicker basePath="/admin/performance" period={period} today={today} />

      {summary.people.length === 0 ? (
        <EmptyState
          title="No floor staff in this period"
          body="The warehouse manager adds people from the staff sheet. Once they are on the roster and their days are recorded, this review fills in."
        />
      ) : (
        <>
          {/* 1. Was the sheet filled? */}
          <Card className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-base font-medium">
                Sheet filled on{' '}
                <span
                  className={cn(
                    'tabular-nums',
                    totals.completeDates < totals.expectedDates ? 'text-amber-700' : 'text-emerald-700',
                  )}
                >
                  {totals.completeDates} of {totals.expectedDates}
                </span>{' '}
                working days
              </h2>
              <p className="text-sm text-stone-500">
                {totals.flags} quality {totals.flags === 1 ? 'flag' : 'flags'}
              </p>
            </div>
            {gaps.length > 0 ? (
              <>
                <p className="text-sm text-stone-600">
                  Days below are missing some or all of the sheet. They are left out of every figure on this page —
                  not counted as absence and not counted against anyone’s target. A run of them usually means the
                  sheet is costing the manager too much time.
                </p>
                <ul className="flex flex-wrap gap-1.5">
                  {gaps.map((d) => {
                    const fill = summary.dates.find((f) => f.date === d)!
                    const empty = fill.state === 'empty'
                    return (
                      <li key={d}>
                        <Link
                          href={`/warehouse/staff?date=${d}`}
                          title={empty ? 'Nobody recorded' : `Missing: ${fill.missing.map((m) => m.name).join(', ')}`}
                          className={cn(
                            'inline-flex min-h-9 items-center gap-1 rounded-lg border px-2 text-sm',
                            empty ? 'border-red-300 bg-red-50 text-red-800' : 'border-amber-300 bg-amber-50 text-amber-800',
                          )}
                        >
                          {formatDay(d)}
                          <span className="text-xs tabular-nums">
                            {empty ? 'none' : `${fill.recorded}/${fill.expected}`}
                          </span>
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </>
            ) : (
              totals.expectedDates > 0 && <p className="text-sm text-stone-600">Every working day is recorded.</p>
            )}
          </Card>

          {/* 2. Per person */}
          <section className="space-y-2">
            <h2 className="text-sm font-medium text-stone-700">By person</h2>
            <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
              <table className="w-full text-sm">
                <thead className="bg-stone-50 text-left text-xs text-stone-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">Name</th>
                    <th className="px-3 py-2 text-right font-medium" title="Present + half days counted as ½">
                      Days in
                    </th>
                    <th className="px-3 py-2 text-right font-medium">Absent / leave</th>
                    <th className="px-3 py-2 text-right font-medium" title="Working days with no record for this person">
                      Not recorded
                    </th>
                    {shownTasks.map((t) => (
                      <th key={t.code} className="px-3 py-2 text-right font-medium whitespace-nowrap">
                        {t.label}
                        {t.targetPerDay !== null && (
                          <span className="block font-normal text-stone-400">{t.targetPerDay}/day</span>
                        )}
                      </th>
                    ))}
                    <th
                      className="px-3 py-2 text-right font-medium"
                      title="All targeted work, in full-day targets, divided by days in. Mixed tasks add up."
                    >
                      Output
                    </th>
                    <th className="px-3 py-2 text-right font-medium">Flags</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {summary.people.map((p) => (
                    <PersonRow key={p.staff.id} person={p} shownTasks={shownTasks.map((t) => t.code)} query={q} />
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-stone-500">
              Counts are the warehouse manager’s rough daily numbers, not timings. Targets are per full day and scale
              with attendance: a half day is half a target. “Output” adds all work that has a target, so a person who
              split the day between picking and packing is not marked down on both.
            </p>
          </section>

          {/* 3. The grid */}
          <section className="space-y-2">
            <h2 className="text-sm font-medium text-stone-700">Day by day</h2>
            <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white p-3">
              <table className="border-separate border-spacing-1 text-xs">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-10 bg-white" />
                    {summary.dates.map((d) => (
                      <th
                        key={d.date}
                        className={cn('w-9 font-normal', d.working ? 'text-stone-500' : 'text-stone-300')}
                      >
                        <span className="block">{weekdayInitial(d.date)}</span>
                        <span className="block tabular-nums">{Number(d.date.slice(8, 10))}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {summary.people.map((p) => (
                    <tr key={p.staff.id}>
                      <th className="sticky left-0 z-10 bg-white pr-2 text-left text-sm font-normal whitespace-nowrap">
                        <Link href={`/admin/performance/staff/${p.staff.id}?${q}`} className="hover:underline">
                          {p.staff.name}
                        </Link>
                      </th>
                      {summary.dates.map((d) => (
                        <td key={d.date}>
                          <Link href={`/warehouse/staff?date=${d.date}`} aria-label={`${p.staff.name}, ${formatDay(d.date)}`}>
                            <GridCell cell={p.cells[d.date]} title={`${p.staff.name}, ${formatDay(d.date)}`} />
                          </Link>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Legend />
          </section>
        </>
      )}
    </div>
  )
}

function PersonRow({ person: p, shownTasks, query }: { person: PersonSummary; shownTasks: string[]; query: string }) {
  return (
    <tr className="align-top">
      <td className="px-3 py-2">
        <Link href={`/admin/performance/staff/${p.staff.id}?${query}`} className="font-medium text-stone-900 hover:underline">
          {p.staff.name}
        </Link>
        {!p.staff.active && <span className="ml-1 text-xs text-stone-400">(left)</span>}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        {formatDays(p.attendanceDays)}
        {p.attendance.half_day > 0 && (
          <span className="block text-xs text-stone-400">
            {p.attendance.half_day} half {p.attendance.half_day === 1 ? 'day' : 'days'}
          </span>
        )}
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-stone-600">
        {p.attendance.absent} / {p.attendance.leave}
      </td>
      <td className={cn('px-3 py-2 text-right tabular-nums', p.unrecordedDates.length > 0 ? 'text-red-700' : 'text-stone-400')}>
        {p.unrecordedDates.length}
      </td>
      {shownTasks.map((code) => {
        const t = p.tasks.find((x) => x.code === code)
        if (!t) return <td key={code} className="px-3 py-2 text-right text-stone-300">—</td>
        return (
          <td key={code} className="px-3 py-2 text-right whitespace-nowrap tabular-nums">
            <span className={t.total === 0 ? 'text-stone-400' : 'text-stone-900'}>{t.total.toLocaleString('en-IN')}</span>
            {t.target !== null && t.target > 0 && (
              <span className="block text-xs text-stone-400">
                of {Math.round(t.target).toLocaleString('en-IN')}{' '}
                <span className={completionTone(t.completion)}>{formatPercent(t.completion)}</span>
              </span>
            )}
          </td>
        )
      })}
      <td className={cn('px-3 py-2 text-right font-medium tabular-nums', completionTone(p.output.ratio))}>
        {formatPercent(p.output.ratio)}
      </td>
      <td className={cn('px-3 py-2 text-right tabular-nums', p.flags.total > 0 ? 'text-red-700' : 'text-stone-400')}>
        {p.flags.total}
      </td>
    </tr>
  )
}
