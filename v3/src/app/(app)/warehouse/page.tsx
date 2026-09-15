import Link from 'next/link'
import { requireRole } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui/primitives'
import { DashboardSection, SectionError, Tile, TileGrid, settle, toneWhen } from '@/components/dashboard/tile'
import { loadRecentFill, loadTodaySheetStatus } from '@/lib/performance/summary'
import { formatDay, weekdayInitial } from '@/lib/performance/period'
import { loadIntakeCounts } from '@/lib/intake/summary'
import { loadInwardCounts } from '@/lib/inwarding/summary'
import { cn } from '@/lib/utils'

export const metadata = { title: 'Warehouse · Nerige' }

/**
 * The warehouse manager's home.
 *
 * Three jobs live in this application for him, and this screen puts them in the
 * order a day runs: record the floor staff, get new sarees photographed and
 * submitted, receive what the weavers sent. The staff sheet is first and
 * largest on purpose — it is the one job nobody will chase him for until the
 * founders notice a fortnight of gaps, so the home screen is what chases.
 *
 * "Mine" is scoped by `user.id`, never left to RLS: while a developer views as
 * the warehouse manager the queries run under the developer's session, which
 * reads everyone's intakes. The admin opening this page sees everybody's.
 */
export default async function WarehouseHomePage() {
  const user = await requireRole('admin', 'warehouse_manager')
  const supabase = await createClient()
  const mineOnly = user.role === 'warehouse_manager'

  const [sheet, fill, intake, inward] = await Promise.all([
    settle(() => loadTodaySheetStatus(supabase)),
    settle(() => loadRecentFill(supabase)),
    settle(() => loadIntakeCounts(supabase, mineOnly ? { submittedBy: user.id } : {})),
    settle(() => loadInwardCounts(supabase)),
  ])

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <PageHeader
        title="Warehouse"
        subtitle={mineOnly ? `Good day, ${user.fullName.split(' ')[0]}.` : 'The warehouse manager’s home, as they see it.'}
        action={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/intake/new"
              className="inline-flex min-h-11 items-center rounded-lg border border-stone-300 px-4 text-sm font-medium hover:bg-stone-50"
            >
              New saree
            </Link>
            <Link
              href="/warehouse/inward"
              className="inline-flex min-h-11 items-center rounded-lg border border-stone-300 px-4 text-sm font-medium hover:bg-stone-50"
            >
              Receive a parcel
            </Link>
          </div>
        }
      />

      <DashboardSection title="Floor staff">
        {sheet.ok ? (
          <Link
            href="/warehouse/staff"
            className={cn(
              'flex flex-wrap items-center gap-4 rounded-xl border p-5 transition-colors',
              sheet.value.state === 'complete' && 'border-emerald-200 bg-emerald-50/60 hover:border-emerald-300',
              sheet.value.state === 'not_expected' && 'border-stone-200 hover:border-stone-300',
              (sheet.value.state === 'partial' || sheet.value.state === 'empty') &&
                'border-amber-300 bg-amber-50 hover:border-amber-400',
            )}
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm text-stone-600">Today&rsquo;s staff sheet</p>
              <p className="mt-1 text-2xl font-medium">
                {sheet.value.state === 'not_expected'
                  ? 'Not a working day'
                  : sheet.value.state === 'complete'
                    ? `All ${sheet.value.expected} recorded`
                    : `${sheet.value.recorded} of ${sheet.value.expected} recorded`}
              </p>
              {sheet.value.missing.length > 0 && (
                <p className="mt-1 text-sm text-stone-600">
                  Still to do: {sheet.value.missing.map((m) => m.name).join(', ')}
                </p>
              )}
            </div>
            <span className="inline-flex min-h-11 items-center rounded-lg bg-stone-900 px-4 text-sm font-medium text-white">
              {sheet.value.state === 'complete' ? 'Open sheet' : 'Fill in today'}
            </span>
          </Link>
        ) : (
          <SectionError message={sheet.error} />
        )}

        {fill.ok && (
          <ol className="flex gap-2" aria-label="The last seven days">
            {fill.value.map((day) => (
              <li key={day.date} className="flex-1">
                <Link
                  href={`/warehouse/staff?date=${day.date}`}
                  title={`${formatDay(day.date)}: ${day.recorded} of ${day.expected} recorded`}
                  className={cn(
                    'flex min-h-11 flex-col items-center justify-center rounded-lg border text-xs',
                    day.state === 'complete' && 'border-emerald-200 bg-emerald-50 text-emerald-800',
                    day.state === 'partial' && 'border-amber-200 bg-amber-50 text-amber-800',
                    day.state === 'empty' && 'border-red-200 bg-red-50 text-red-800',
                    day.state === 'not_expected' && 'border-stone-200 text-stone-400',
                  )}
                >
                  <span className="font-medium">{weekdayInitial(day.date)}</span>
                  <span className="tabular-nums">{day.state === 'not_expected' ? '—' : `${day.recorded}/${day.expected}`}</span>
                </Link>
              </li>
            ))}
          </ol>
        )}
      </DashboardSection>

      <DashboardSection title={mineOnly ? 'Sarees you submitted' : 'New sarees'}>
        {intake.ok ? (
          <TileGrid>
            <Tile
              href="/warehouse/shooting"
              label="Waiting to be shot"
              value={intake.value.awaitingShoot}
              tone={toneWhen(intake.value.awaitingShoot, 'waiting')}
            />
            <Tile
              href="/warehouse/shooting"
              label="Shot, photos not sent on"
              value={intake.value.awaitingUpload}
              tone={toneWhen(intake.value.awaitingUpload, 'waiting')}
            />
            <Tile
              href="/intake/queue"
              label="Rejected — needs a reshoot"
              value={intake.value.rejected}
              tone={toneWhen(intake.value.rejected, 'bad')}
            />
            <Tile
              href="/intake/queue"
              label="Drafts"
              value={intake.value.drafts}
              hint="Waiting for a master-data value"
            />
          </TileGrid>
        ) : (
          <SectionError message={intake.error} />
        )}
      </DashboardSection>

      <DashboardSection title="Receiving from weavers">
        {inward.ok ? (
          <TileGrid>
            <Tile
              href="/warehouse/inward"
              label="Parcels on their way"
              value={inward.value.expected}
              hint="Dispatched by the weaver"
              tone={toneWhen(inward.value.expected, 'waiting')}
            />
            <Tile
              href="/warehouse/inward"
              label="Partly received"
              value={inward.value.partiallyReceived}
              tone={toneWhen(inward.value.partiallyReceived, 'waiting')}
            />
            <Tile
              href="/warehouse/inward"
              label="Late, not yet dispatched"
              value={inward.value.lateNotDispatched}
            />
            <Tile href="/warehouse/inward" label="Received this week" value={inward.value.receivedThisWeek} tone="good" />
          </TileGrid>
        ) : (
          <SectionError message={inward.error} />
        )}
      </DashboardSection>
    </div>
  )
}
