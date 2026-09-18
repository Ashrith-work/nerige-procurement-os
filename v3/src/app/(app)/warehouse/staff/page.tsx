import { requireStaffRecorder } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { Alert, PageHeader } from '@/components/ui/primitives'
import { loadDayRecords, loadRecentFill, loadRoster, loadTasks } from '@/lib/performance/summary'
import {
  EDIT_WINDOW_DAYS,
  formatLongDay,
  isIsoDate,
  isWithinEditWindow,
  todayInWarehouse,
} from '@/lib/performance/period'
import { SheetScreen, type SheetPerson } from './sheet-screen'
import { Roster } from './roster'

export const metadata = { title: 'Staff sheet' }

/** Resolved outside the component body: the purity rule forbids reading the clock in render. */
function resolveDate(requested: string | undefined): { date: string; today: string; clamped: boolean } {
  const today = todayInWarehouse()
  if (!isIsoDate(requested)) return { date: today, today, clamped: false }
  if (requested > today) return { date: today, today, clamped: true }
  return { date: requested, today, clamped: false }
}

/**
 * The warehouse manager's register for the floor staff.
 *
 * ONE screen, built for one thing: getting six people's day onto the record in
 * under two minutes, on a tablet, standing up. Everything that is not that —
 * the review, the targets, the percentages — lives with the founders at
 * /admin/performance. The manager sees no percentages here at all: they are
 * recording, not grading, and a number next to each name while typing it
 * would turn a register into a negotiation.
 *
 * The floor staff themselves have no login and never see this. See migration
 * 034 for why.
 */
export default async function StaffSheetPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>
}) {
  const params = await searchParams
  const user = await requireStaffRecorder()
  const { date, today, clamped } = resolveDate(params.date)
  const supabase = await createClient()

  const [roster, tasks, records, recent] = await Promise.all([
    loadRoster(supabase, { includeInactive: true }),
    loadTasks(supabase, { includeInactive: true }),
    loadDayRecords(supabase, { from: date, to: date }),
    loadRecentFill(supabase, today, 7),
  ])

  const recordFor = new Map(records.map((r) => [r.staffId, r]))

  // Who belongs on THIS day's sheet: anyone employed that day, plus anyone
  // already recorded on it (a record outlives a later deactivation). Sunday is
  // not excluded — if the manager opens a Sunday, it was worked.
  const people: SheetPerson[] = roster
    .filter(
      (s) =>
        recordFor.has(s.id) ||
        (s.startedOn <= date && (s.deactivatedOn === null || s.deactivatedOn > date)),
    )
    .map((s) => {
      const r = recordFor.get(s.id)
      return {
        id: s.id,
        name: s.name,
        attendance: r?.attendance ?? null,
        note: r?.note ?? '',
        counts: r?.counts ?? {},
        flags: (r?.flags ?? []).map((f) => ({ id: f.id, kind: f.kind, orderRef: f.orderRef, note: f.note })),
      }
    })

  // Retired tasks stay on the sheet only for a day that already used them.
  const sheetTasks = tasks
    .filter((t) => t.active || records.some((r) => (r.counts[t.code] ?? 0) > 0))
    .map((t) => ({ code: t.code, label: t.label }))

  const readOnlyReason = user.viewAs
    ? `You are viewing as ${user.fullName}. Nothing can be saved.`
    : user.role !== 'admin' && !isWithinEditWindow(date, today)
      ? `Days older than ${EDIT_WINDOW_DAYS} days are closed. Ask a founder if something here is wrong.`
      : null

  // Remounts the form after a save brings back new rows, so the pending flags
  // that were just saved do not stay pending and get saved twice.
  const sheetKey = `${date}|${records
    .map((r) => `${r.staffId}:${r.updatedAt}:${r.flags.map((f) => f.id).join(',')}`)
    .join(';')}`

  return (
    <div className="mx-auto max-w-5xl space-y-5 pb-28">
      <PageHeader
        title="Staff sheet"
        subtitle={`${formatLongDay(date)}${date === today ? ' · today' : ''}`}
      />

      {clamped && <Alert>That date has not happened yet, so this is today’s sheet.</Alert>}

      <SheetScreen
        key={date}
        date={date}
        today={today}
        people={people}
        tasks={sheetTasks}
        recent={recent.map((d) => ({ date: d.date, state: d.state, recorded: d.recorded, expected: d.expected }))}
        readOnlyReason={readOnlyReason}
        sheetKey={sheetKey}
      />

      <Roster
        people={roster.map((s) => ({ id: s.id, name: s.name, active: s.active, startedOn: s.startedOn }))}
        today={today}
        readOnly={Boolean(user.viewAs)}
      />
    </div>
  )
}
