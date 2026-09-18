'use client'

import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Alert, cn } from '@/components/ui/primitives'
import { addDays, WAREHOUSE_TIME_ZONE, type IsoDate } from '@/lib/performance/period'
import {
  MOVEMENTS,
  type DayTotals,
  type MovementKind,
  type MovementRow,
} from '@/lib/day-sheet/calc'
import { MovementSection } from './movement-section'
import { SummaryRail } from './summary-rail'
import { addMovement, removeMovement, saveDayTotals, updateMovement } from './actions'

/**
 * The in-house movement half of the day sheet — everything on this screen that
 * is typed rather than read.
 *
 * WHY IT SAVES ITSELF. The staff sheet next door is one register filled in one
 * sitting behind one Save button, and that is right for it. This is not that: a
 * saree goes up to the CEC at eleven and comes back at four, and the manager
 * touches this page eight times between other work, on a tablet that locks
 * itself on the bench. A batch of ticks waiting behind a button is a batch that
 * is lost the first time somebody walks away — so each tick is written as it is
 * made, and the counted totals go the moment the cursor leaves the box.
 *
 * The button in the bar at the foot is therefore not how work is saved. It is
 * there so the keyboard shortcut has a visible home and so "is it in?" has an
 * answer you can point at.
 */

interface TotalsDraft {
  out: Record<MovementKind, string>
  back: Record<MovementKind, string>
  videoOrders: string
  note: string
}

function toDraft(totals: DayTotals): TotalsDraft {
  return {
    out: { cec: String(totals.out.cec), ai_colour: String(totals.out.ai_colour), video_call: String(totals.out.video_call) },
    back: { cec: String(totals.back.cec), ai_colour: String(totals.back.ai_colour), video_call: String(totals.back.video_call) },
    videoOrders: String(totals.videoOrders),
    note: totals.note,
  }
}

const num = (value: string): number => Number(value || 0)

const same = (a: TotalsDraft, b: TotalsDraft): boolean => JSON.stringify(a) === JSON.stringify(b)

/**
 * The warehouse's clock, for "saved at".
 *
 * Read here rather than in a component body, where the purity rule forbids it —
 * and in the warehouse's own zone, because a manager in Bengaluru reading a
 * time rendered in the server's zone would be told their last save was five
 * hours ago.
 */
function savedAtLabel(): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: WAREHOUSE_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date())
}

const UNSAVED = 'The counts at the top have changes that are not saved. Leave without saving?'

export function DaySheet({
  date,
  today,
  totals,
  movements,
  people,
  readOnlyReason,
  railPanels,
}: {
  date: IsoDate
  today: IsoDate
  totals: DayTotals
  movements: MovementRow[]
  /** Names off the floor-staff roster, suggested in the "who" column. */
  people: readonly string[]
  /** Why this account cannot write today, or null when it can. */
  readOnlyReason: string | null
  /** The orders and staff panels. Server-rendered, shown in the rail. */
  railPanels?: ReactNode
}) {
  const router = useRouter()
  const readOnly = readOnlyReason !== null

  // One movement in front of him at a time. The notebook has all three on one
  // page because paper cannot switch; a screen that shows three grids at once
  // makes him scroll past two to reach the one he is filling in. The other two
  // stay one line each in the rail, so nothing is out of sight — only out of
  // the way.
  const [active, setActive] = useState<MovementKind>('cec')
  const [draft, setDraft] = useState(() => toDraft(totals))
  const [saved, setSaved] = useState(() => toDraft(totals))
  const [rows, setRows] = useState(movements)
  const [pending, setPending] = useState(0)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const dirty = !same(draft, saved)

  // Read by the Ctrl+S handler, which is bound on the window and would
  // otherwise close over whatever the boxes held when it was bound. Kept in
  // step by an effect rather than written during render, where a ref is not
  // ours to touch.
  const draftRef = useRef(draft)
  useEffect(() => {
    draftRef.current = draft
  }, [draft])

  /** Runs one write, counts it while it is in flight, and reports a refusal. */
  const run = useCallback(async <T,>(write: () => Promise<T>): Promise<T> => {
    setPending((n) => n + 1)
    try {
      return await write()
    } finally {
      setPending((n) => n - 1)
    }
  }, [])

  const commitTotals = useCallback(
    (next: TotalsDraft) => {
      if (readOnly || same(next, saved)) return
      // Recorded as saved straight away: the boxes are a count, not a form, and
      // showing it back as unsaved while the request is in flight makes a
      // manager type it a second time. A refusal below puts it back.
      setSaved(next)
      setError(null)
      void run(async () => {
        const result = await saveDayTotals({
          date,
          out: { cec: num(next.out.cec), ai_colour: num(next.out.ai_colour), video_call: num(next.out.video_call) },
          back: { cec: num(next.back.cec), ai_colour: num(next.back.ai_colour), video_call: num(next.back.video_call) },
          videoOrders: num(next.videoOrders),
          note: next.note,
        })
        if (result.ok) setSavedAt(savedAtLabel())
        else {
          setSaved(saved)
          setError(result.message)
        }
      })
    },
    [date, readOnly, run, saved],
  )

  // Ctrl/Cmd+S, for the manager working from a laptop keyboard. The work is
  // already going in as it is typed; this is the reassurance that it has.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        commitTotals(draftRef.current)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [commitTotals])

  // Closing the tab with a half-typed count gets the browser's own prompt.
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const guardLeaving = (e: MouseEvent) => {
    if (dirty && !window.confirm(UNSAVED)) e.preventDefault()
  }

  const goToDate = (target: string) => {
    if (!target || target === date) return
    if (dirty && !window.confirm(UNSAVED)) return
    router.push(`/warehouse/day?date=${target}`)
  }

  const setTotal = (kind: MovementKind, which: 'out' | 'back', value: string) =>
    setDraft((d) => ({ ...d, [which]: { ...d[which], [kind]: value } }))

  /** Write a saree down. Returns false when the database refused it. */
  const addRow = async (kind: MovementKind, sku: string): Promise<boolean> => {
    setError(null)
    const result = await run(() => addMovement({ date, kind, sku }))
    if (!result.ok) {
      setError(result.message)
      return false
    }
    setRows((current) => [...current, result.row])
    setSavedAt(savedAtLabel())
    return true
  }

  /**
   * Change one cell. On screen at once; put back if the database says no.
   *
   * The row is what the manager is looking at while they tick it, so it moves
   * first — but `rows` is never the record. Every one of these is an UPDATE
   * against RLS, and the reload of this page reads the day back from Postgres.
   */
  const patchRow = (id: string, patch: Partial<MovementRow>) => {
    const before = rows.find((r) => r.id === id)
    if (!before) return
    setError(null)
    setRows((current) => current.map((r) => (r.id === id ? { ...r, ...patch } : r)))

    void run(async () => {
      const result = await updateMovement({ id, patch })
      if (result.ok) setSavedAt(savedAtLabel())
      else {
        setRows((current) => current.map((r) => (r.id === id ? before : r)))
        setError(result.message)
      }
    })
  }

  const removeRow = (id: string) => {
    const before = rows
    setError(null)
    setRows((current) => current.filter((r) => r.id !== id))

    void run(async () => {
      const result = await removeMovement({ id })
      if (result.ok) setSavedAt(savedAtLabel())
      else {
        setRows(before)
        setError(result.message)
      }
    })
  }

  return (
    <div className="space-y-6 pb-24">
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/warehouse/day?date=${addDays(date, -1)}`}
          onClick={guardLeaving}
          aria-label="The day before"
          className="inline-flex min-h-12 min-w-12 items-center justify-center rounded-lg border border-stone-300 bg-white hover:bg-stone-50"
        >
          <ChevronLeft aria-hidden className="size-5" />
        </Link>
        <input
          type="date"
          value={date}
          max={today}
          onChange={(e) => goToDate(e.target.value)}
          aria-label="Which day"
          className="min-h-12 rounded-lg border border-stone-300 bg-white px-3 text-base"
        />
        {date < today ? (
          <Link
            href={`/warehouse/day?date=${addDays(date, 1)}`}
            onClick={guardLeaving}
            aria-label="The day after"
            className="inline-flex min-h-12 min-w-12 items-center justify-center rounded-lg border border-stone-300 bg-white hover:bg-stone-50"
          >
            <ChevronRight aria-hidden className="size-5" />
          </Link>
        ) : (
          <span
            aria-hidden
            className="inline-flex min-h-12 min-w-12 items-center justify-center rounded-lg border border-stone-200 text-stone-300"
          >
            <ChevronRight className="size-5" />
          </span>
        )}
        {date !== today && (
          <Link
            href="/warehouse/day"
            onClick={guardLeaving}
            className="inline-flex min-h-12 items-center rounded-lg px-3 text-sm font-medium text-stone-700 hover:bg-stone-100"
          >
            Today
          </Link>
        )}
      </div>

      {readOnlyReason && <Alert>{readOnlyReason}</Alert>}
      {error && <Alert tone="error">{error}</Alert>}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <section aria-labelledby="in-house" className="space-y-4">
          <div>
            <h2 id="in-house" className="text-lg font-medium tracking-tight text-stone-900">
              In-house movement
            </h2>
            <p className="text-sm text-stone-600">
              Every saree that left the building today, and whether it came back.
            </p>
          </div>

          {/* Which movement he is filling in. A real tablist, so the arrow keys
              move between them and a screen reader announces the switch. */}
          <div role="tablist" aria-label="Movement" className="flex flex-wrap gap-1 border-b border-stone-200">
            {MOVEMENTS.map((definition) => {
              const isActive = definition.kind === active
              return (
                <button
                  key={definition.kind}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  aria-controls={`panel-${definition.kind}`}
                  id={`tab-${definition.kind}`}
                  onClick={() => setActive(definition.kind)}
                  className={cn(
                    'min-h-11 rounded-t-lg px-3 text-sm',
                    'focus-visible:ring-2 focus-visible:ring-stone-900 focus-visible:ring-offset-2 focus-visible:outline-none',
                    isActive
                      ? '-mb-px border-x border-t border-stone-300 bg-white font-medium text-stone-900'
                      : 'text-stone-600 hover:bg-stone-100 hover:text-stone-900',
                  )}
                >
                  {definition.label}
                </button>
              )
            })}
          </div>

          {MOVEMENTS.map((definition) => (
            <div
              key={definition.kind}
              id={`panel-${definition.kind}`}
              role="tabpanel"
              aria-labelledby={`tab-${definition.kind}`}
              // Hidden rather than unmounted: the half-typed code in the add box
              // survives a glance at another movement, which is the whole reason
              // somebody switches tabs mid-count.
              hidden={definition.kind !== active}
            >
              <MovementSection
                definition={definition}
                rows={rows.filter((r) => r.kind === definition.kind)}
                out={draft.out[definition.kind]}
                back={draft.back[definition.kind]}
                onTotalChange={(which, value) => setTotal(definition.kind, which, value)}
                onTotalCommit={() => commitTotals(draft)}
                onAdd={(sku) => addRow(definition.kind, sku)}
                onPatch={patchRow}
                onRemove={removeRow}
                readOnly={readOnly}
                people={people}
                summaryInRail
                extra={
                  definition.kind === 'video_call' ? (
                    <label className="flex flex-wrap items-center gap-3 rounded-xl border border-stone-200 bg-white px-3 py-2">
                      <span className="text-sm text-stone-700">
                        Orders that began as a video call
                        <span className="block text-xs text-stone-500">
                          The one order figure nobody else records.
                        </span>
                      </span>
                      <input
                        type="number"
                        min={0}
                        inputMode="numeric"
                        value={draft.videoOrders}
                        disabled={readOnly}
                        onChange={(e) => setDraft((d) => ({ ...d, videoOrders: e.target.value }))}
                        onBlur={() => commitTotals(draft)}
                        className="ml-auto min-h-11 w-24 rounded-lg border border-stone-300 bg-white px-3 text-xl font-medium tabular-nums focus:border-stone-500 focus:ring-1 focus:ring-stone-500 focus:outline-none disabled:bg-stone-50 disabled:text-stone-500"
                      />
                    </label>
                  ) : undefined
                }
              />
            </div>
          ))}

          <label className="block space-y-1.5">
            <span className="block text-sm font-medium text-stone-700">Anything else about today</span>
            <textarea
              value={draft.note}
              disabled={readOnly}
              maxLength={1000}
              rows={2}
              placeholder="Optional. A sentence for whoever reads this back."
              onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))}
              onBlur={() => commitTotals(draft)}
              className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-base placeholder:text-stone-400 focus:border-stone-500 focus:ring-1 focus:ring-stone-500 focus:outline-none disabled:bg-stone-50"
            />
          </label>
        </section>

        <SummaryRail
          active={active}
          rows={rows}
          out={draft.out[active]}
          back={draft.back[active]}
          onJump={setActive}
        >
          {railPanels}
        </SummaryRail>
      </div>

      {!readOnly && (
        <div
          className="fixed inset-x-0 bottom-0 z-20 border-t border-stone-200 bg-white/95 px-4 py-3 backdrop-blur"
          style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
        >
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
            <p className="text-sm text-stone-600" aria-live="polite">
              {pending > 0
                ? 'Saving…'
                : dirty
                  ? 'The counts at the top are not saved yet'
                  : savedAt
                    ? `Saved at ${savedAt}`
                    : 'Everything on this day is saved'}
            </p>
            <button
              type="button"
              onClick={() => commitTotals(draft)}
              disabled={!dirty || pending > 0}
              className={cn(
                'inline-flex min-h-12 min-w-36 items-center justify-center rounded-lg px-4 text-base font-medium',
                'bg-stone-900 text-white hover:bg-stone-800',
                'focus-visible:ring-2 focus-visible:ring-stone-900 focus-visible:ring-offset-2 focus-visible:outline-none',
                'disabled:pointer-events-none disabled:opacity-50',
              )}
            >
              Save the counts
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
