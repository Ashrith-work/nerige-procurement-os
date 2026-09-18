import { Alert, LinkButton, cn } from '@/components/ui/primitives'
import type { StaffDayLine } from '@/lib/day-sheet/loaders'

/**
 * Who worked, and on what, on this day.
 *
 * Quoted from the staff sheet, never re-entered here. The sheet is filled in at
 * /warehouse/staff, and a second place to type the same numbers would produce
 * two answers to one question and no way to tell which is the record.
 *
 * Not everybody who can open the day sheet can see this: the floor staff's
 * register is the warehouse manager's and the founders', and procurement and
 * support hold no read on it at all (migration 034). Rather than let RLS return
 * an empty list that reads as "nobody worked today", the page says plainly that
 * the section is not theirs.
 */
export function StaffSection({
  date,
  lines,
  visible,
  error,
}: {
  date: string
  lines: StaffDayLine[]
  /** Whether this account may read the floor-staff sheet at all. */
  visible: boolean
  error: string | null
}) {
  return (
    <section aria-labelledby="staff" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="staff" className="text-lg font-medium tracking-tight text-stone-900">
            Staff work log
          </h2>
          <p className="text-sm text-stone-600">Read from the staff sheet. Fill it in there.</p>
        </div>
        {visible && (
          <LinkButton href={`/warehouse/staff?date=${date}`}>Open the staff sheet</LinkButton>
        )}
      </div>

      {!visible && (
        <p className="text-sm text-stone-600">
          The floor staff&rsquo;s sheet is kept by the warehouse manager and read by the founders. Your
          account does not open it.
        </p>
      )}

      {visible && error && (
        <Alert tone="error">
          The staff sheet could not be read for this day. Try reloading; if it keeps failing, tell a
          developer: {error}
        </Alert>
      )}

      {visible && !error && lines.length === 0 && (
        <p className="text-sm text-stone-600">
          Nobody is on the roster for this day yet. Add the floor staff on the staff sheet, then their
          day shows here.
        </p>
      )}

      {visible && !error && lines.length > 0 && (
        <ul className="divide-y divide-stone-100 overflow-hidden rounded-xl border border-stone-200 bg-white">
          {lines.map((line) => (
            <li key={line.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-3">
              <span className="min-w-28 font-medium text-stone-900">{line.name}</span>
              <span
                className={cn(
                  'text-sm',
                  line.attendance === null ? 'text-amber-800' : 'text-stone-600',
                )}
              >
                {line.attendanceLabel}
              </span>
              <span className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-stone-700">
                {line.counts.map((c) => (
                  <span key={c.code}>
                    {c.label} <span className="font-medium tabular-nums">{c.quantity}</span>
                  </span>
                ))}
              </span>
              {line.flags > 0 && (
                <span className="text-sm text-red-700">
                  {line.flags} {line.flags === 1 ? 'problem' : 'problems'} flagged
                </span>
              )}
              <span className="ml-auto text-sm text-stone-500 tabular-nums">
                {line.total > 0 ? `${line.total} in all` : '—'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
