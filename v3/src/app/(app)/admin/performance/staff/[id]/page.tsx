import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireStaffReview } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { Card, PageHeader, cn } from '@/components/ui/primitives'
import { isStaffId, loadPeriodSummary } from '@/lib/performance/summary'
import { FLAG_KINDS, formatDays, formatPercent } from '@/lib/performance/calc'
import { formatDay, formatLongDay, resolvePeriod, todayInWarehouse } from '@/lib/performance/period'
import { PeriodPicker, periodQuery } from '../../period-picker'
import { ATTENDANCE_TONE, attendanceLabel } from '../../cells'

export const metadata = { title: 'Staff member' }

function currentPeriod(params: { preset?: string; from?: string; to?: string }) {
  const today = todayInWarehouse()
  return { today, period: resolvePeriod(params, today) }
}

/**
 * One person, one period, every day.
 *
 * The summary row on the review answers "how are they doing"; this answers
 * "why does it say that" — which days were half days, what the flags were
 * about, what the manager wrote, and which days nobody recorded at all. Newest
 * first, because the question is almost always about last week.
 */
export default async function StaffMemberPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ preset?: string; from?: string; to?: string }>
}) {
  const [{ id }, search] = await Promise.all([params, searchParams])
  await requireStaffReview()
  if (!isStaffId(id)) notFound()

  const { today, period } = currentPeriod(search)
  const supabase = await createClient()
  const summary = await loadPeriodSummary(supabase, period, { staffId: id })

  const person = summary.people[0]
  if (!person) {
    // Either no such person, or nobody expected and nothing recorded in this
    // period. Tell those apart rather than 404 a real person.
    const { data } = await supabase.from('floor_staff').select('display_name').eq('id', id).maybeSingle()
    if (!data) notFound()
    return (
      <div className="space-y-5">
        <PageHeader title={data.display_name as string} subtitle="Not on the sheet in this period." />
        <PeriodPicker basePath={`/admin/performance/staff/${id}`} period={period} today={today} />
      </div>
    )
  }

  const recordFor = new Map(summary.records.map((r) => [r.date, r]))
  const labelFor = new Map(summary.tasks.map((t) => [t.code, t.label]))
  const days = [...summary.dates].reverse()

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <Link
        href={`/admin/performance?${periodQuery(period)}`}
        className="inline-flex min-h-11 items-center text-sm text-stone-600 hover:underline"
      >
        Staff performance
      </Link>

      <PageHeader
        title={person.staff.name}
        subtitle={`${formatLongDay(period.from)} – ${formatLongDay(period.to)}${person.staff.active ? '' : ' · no longer on the sheet'}`}
      />

      <PeriodPicker basePath={`/admin/performance/staff/${id}`} period={period} today={today} />

      <div className="grid gap-3 sm:grid-cols-4">
        <Figure label="Days in" value={formatDays(person.attendanceDays)} hint={`${person.attendance.half_day} half days`} />
        <Figure label="Absent / leave" value={`${person.attendance.absent} / ${person.attendance.leave}`} />
        <Figure
          label="Not recorded"
          value={String(person.unrecordedDates.length)}
          hint={`of ${person.expectedDays} working days`}
          tone={person.unrecordedDates.length > 0 ? 'text-red-700' : undefined}
        />
        <Figure label="Output vs target" value={formatPercent(person.output.ratio)} hint="all targeted work" />
      </div>

      <Card className="space-y-2">
        <h2 className="text-sm font-medium text-stone-700">Work</h2>
        <table className="w-full text-sm">
          <caption className="sr-only">Work done in this period, against the target</caption>
          <thead className="sr-only">
            <tr>
              <th scope="col">Task</th>
              <th scope="col">Done</th>
              <th scope="col">Target</th>
              <th scope="col">Share of target</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {person.tasks
              .filter((t) => t.total > 0 || t.target !== null)
              .map((t) => (
                <tr key={t.code}>
                  <td className="py-1.5">{t.label}</td>
                  <td className="py-1.5 text-right tabular-nums">{t.total.toLocaleString('en-IN')}</td>
                  <td className="py-1.5 text-right text-stone-500 tabular-nums">
                    {t.target !== null ? `of ${Math.round(t.target).toLocaleString('en-IN')}` : 'no target'}
                  </td>
                  <td className="w-16 py-1.5 text-right tabular-nums">{formatPercent(t.completion)}</td>
                </tr>
              ))}
          </tbody>
        </table>
        {person.flags.total > 0 && (
          <p className="text-sm text-red-800">
            {person.flags.total} quality {person.flags.total === 1 ? 'flag' : 'flags'}:{' '}
            {FLAG_KINDS.filter((k) => person.flags.byKind[k.value] > 0)
              .map((k) => `${person.flags.byKind[k.value]} ${k.label.toLowerCase()}`)
              .join(', ')}
          </p>
        )}
      </Card>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-stone-700">Every day</h2>
        <ul className="divide-y divide-stone-100 rounded-xl border border-stone-200 bg-white">
          {days.map((d) => {
            const cell = person.cells[d.date]
            const r = recordFor.get(d.date)
            if (cell.kind === 'not_expected' && !r) {
              return (
                <li key={d.date} className="flex items-center gap-3 px-4 py-2 text-sm text-stone-300">
                  <span className="w-24">{formatDay(d.date)}</span>
                  <span>—</span>
                </li>
              )
            }
            return (
              <li key={d.date} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-4 py-3 text-sm">
                <span className="w-24 shrink-0 text-stone-600">{formatDay(d.date)}</span>
                {r ? (
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={cn('rounded px-2 py-0.5 text-xs font-medium', ATTENDANCE_TONE[r.attendance])}>
                        {attendanceLabel(r.attendance)}
                      </span>
                      {Object.entries(r.counts).map(([code, qty]) => (
                        <span key={code} className="text-stone-700 tabular-nums">
                          {labelFor.get(code) ?? code} <span className="font-medium">{qty}</span>
                        </span>
                      ))}
                    </div>
                    {r.flags.map((f) => (
                      <p key={f.id} className="text-red-800">
                        <span className="font-medium">Flag:</span>{' '}
                        {FLAG_KINDS.find((k) => k.value === f.kind)?.label}
                        {f.orderRef && <span className="ml-1 font-mono">{f.orderRef}</span>}
                        {f.note && <span className="ml-1">— {f.note}</span>}
                      </p>
                    ))}
                    {r.note && <p className="text-stone-600 italic">“{r.note}”</p>}
                    <p className="text-xs text-stone-600">
                      Recorded by {r.recordedByName ?? 'somebody no longer on the system'}
                    </p>
                  </div>
                ) : (
                  <span className="flex-1 font-medium text-red-700">Not recorded</span>
                )}
                <Link
                  href={`/warehouse/staff?date=${d.date}`}
                  className="ml-auto text-xs text-stone-500 hover:underline"
                >
                  {r ? 'Correct' : 'Fill in'}
                </Link>
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}

function Figure({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-stone-500">{label}</p>
      <p className={cn('mt-1 text-2xl font-medium tabular-nums', tone)}>{value}</p>
      {hint && <p className="text-xs text-stone-600">{hint}</p>}
    </Card>
  )
}
