'use client'

import { useCallback, useEffect, useRef, useState, useTransition, type FormEvent, type MouseEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight, Flag, X } from 'lucide-react'
import { Alert, Button, cn } from '@/components/ui/primitives'
import {
  ATTENDANCE,
  FLAG_KINDS,
  canHaveWork,
  type Attendance,
  type FlagKind,
} from '@/lib/performance/calc'
import { addDays, weekdayInitial, type IsoDate } from '@/lib/performance/period'
import { saveStaffSheet, type SheetInput } from './actions'

export interface SheetPerson {
  id: string
  name: string
  attendance: Attendance | null
  note: string
  counts: Record<string, number>
  flags: { id: string; kind: FlagKind; orderRef: string | null; note: string | null }[]
}

interface RecentDay {
  date: IsoDate
  state: 'complete' | 'partial' | 'empty' | 'not_expected'
  recorded: number
  expected: number
}

const UNSAVED = 'The sheet has changes that are not saved. Leave without saving?'

/**
 * Date navigation, the last-seven-days strip, and the sheet itself.
 *
 * Split from the form so a save can remount the form with fresh rows (see
 * `sheetKey` on the page) without losing the "Saved" message or the knowledge
 * that there were unsaved changes when somebody taps a different day.
 */
export function SheetScreen({
  date,
  today,
  people,
  tasks,
  recent,
  readOnlyReason,
  sheetKey,
}: {
  date: IsoDate
  today: IsoDate
  people: SheetPerson[]
  tasks: { code: string; label: string }[]
  recent: RecentDay[]
  readOnlyReason: string | null
  sheetKey: string
}) {
  const router = useRouter()
  const dirty = useRef(false)
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)

  const go = useCallback(
    (target: IsoDate) => {
      if (target === date) return
      if (dirty.current && !window.confirm(UNSAVED)) return
      dirty.current = false
      router.push(`/warehouse/staff?date=${target}`)
    },
    [date, router],
  )

  // Stable, so the form's effect fires when dirtiness CHANGES and not on every
  // render — which would otherwise clear a save error the moment it appeared.
  const onDirtyChange = useCallback((d: boolean) => {
    dirty.current = d
    if (d) setMessage(null)
  }, [])

  const guard = (e: MouseEvent) => {
    if (dirty.current && !window.confirm(UNSAVED)) e.preventDefault()
    else dirty.current = false
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/warehouse/staff?date=${addDays(date, -1)}`}
          onClick={guard}
          aria-label="Previous day"
          className="inline-flex min-h-12 min-w-12 items-center justify-center rounded-lg border border-stone-300 bg-white hover:bg-stone-50"
        >
          <ChevronLeft className="size-5" />
        </Link>
        <input
          type="date"
          value={date}
          max={today}
          onChange={(e) => e.target.value && go(e.target.value)}
          aria-label="Sheet date"
          className="min-h-12 rounded-lg border border-stone-300 bg-white px-3 text-base"
        />
        {date < today ? (
          <Link
            href={`/warehouse/staff?date=${addDays(date, 1)}`}
            onClick={guard}
            aria-label="Next day"
            className="inline-flex min-h-12 min-w-12 items-center justify-center rounded-lg border border-stone-300 bg-white hover:bg-stone-50"
          >
            <ChevronRight className="size-5" />
          </Link>
        ) : (
          <span className="inline-flex min-h-12 min-w-12 items-center justify-center rounded-lg border border-stone-200 text-stone-300">
            <ChevronRight className="size-5" />
          </span>
        )}
        {date !== today && (
          <Link
            href="/warehouse/staff"
            onClick={guard}
            className="inline-flex min-h-12 items-center rounded-lg px-3 text-sm font-medium text-stone-700 hover:bg-stone-100"
          >
            Today
          </Link>
        )}
      </div>

      {/*
        * The last seven days at a glance. A red day is a sheet nobody filled —
        * shown here first because it is the manager's own to-do list, and
        * shown in the founders' review later because a pattern of them means
        * the sheet is too much work.
        */}
      <nav aria-label="Last 7 days" className="flex flex-wrap gap-1.5">
        {recent.map((d) => (
          <Link
            key={d.date}
            href={`/warehouse/staff?date=${d.date}`}
            onClick={guard}
            title={
              d.state === 'not_expected'
                ? 'Not a working day'
                : `${d.recorded} of ${d.expected} recorded`
            }
            aria-current={d.date === date ? 'date' : undefined}
            className={cn(
              'flex min-h-12 min-w-12 flex-col items-center justify-center rounded-lg border px-2 text-xs leading-tight',
              d.state === 'complete' && 'border-emerald-200 bg-emerald-50 text-emerald-800',
              d.state === 'partial' && 'border-amber-300 bg-amber-50 text-amber-800',
              d.state === 'empty' && 'border-red-300 bg-red-50 text-red-800',
              d.state === 'not_expected' && 'border-stone-200 bg-stone-50 text-stone-400',
              d.date === date && 'ring-2 ring-stone-900 ring-offset-1',
            )}
          >
            <span>{weekdayInitial(d.date)}</span>
            <span className="text-sm font-medium tabular-nums">{Number(d.date.slice(8, 10))}</span>
            <span className="tabular-nums">
              {d.state === 'complete' ? '✓' : d.state === 'not_expected' ? '·' : `${d.recorded}/${d.expected}`}
            </span>
          </Link>
        ))}
      </nav>

      {readOnlyReason && <Alert>{readOnlyReason}</Alert>}
      {message && <Alert tone={message.tone}>{message.text}</Alert>}

      <SheetForm
        key={sheetKey}
        date={date}
        people={people}
        tasks={tasks}
        readOnly={readOnlyReason !== null}
        onDirtyChange={onDirtyChange}
        onResult={setMessage}
      />
    </div>
  )
}

interface PendingFlag {
  key: number
  kind: FlagKind
  orderRef: string
  note: string
}

interface RowState {
  attendance: Attendance | null
  note: string
  counts: Record<string, string>
  newFlags: PendingFlag[]
  removed: string[]
}

function initialRows(people: SheetPerson[]): Record<string, RowState> {
  return Object.fromEntries(
    people.map((p) => [
      p.id,
      {
        attendance: p.attendance,
        note: p.note,
        counts: Object.fromEntries(Object.entries(p.counts).map(([k, v]) => [k, String(v)])),
        newFlags: [],
        removed: [],
      },
    ]),
  )
}

const same = (a: RowState, b: RowState) => JSON.stringify(a) === JSON.stringify(b)

function SheetForm({
  date,
  people,
  tasks,
  readOnly,
  onDirtyChange,
  onResult,
}: {
  date: IsoDate
  people: SheetPerson[]
  tasks: { code: string; label: string }[]
  readOnly: boolean
  onDirtyChange: (dirty: boolean) => void
  onResult: (m: { tone: 'success' | 'error'; text: string }) => void
}) {
  const [initial] = useState(() => initialRows(people))
  const [rows, setRows] = useState(initial)
  const [pending, startTransition] = useTransition()
  const nextFlagKey = useRef(1)
  const formRef = useRef<HTMLFormElement>(null)

  const changedIds = people.filter((p) => !same(rows[p.id], initial[p.id])).map((p) => p.id)
  const dirty = changedIds.length > 0
  const marked = people.filter((p) => rows[p.id].attendance !== null).length

  useEffect(() => {
    onDirtyChange(dirty)
  }, [dirty, onDirtyChange])

  // Closing the tab or reloading with unsaved work gets the browser's own prompt.
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  // Ctrl/Cmd+S saves, for the manager on a laptop who never reaches for the mouse.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        formRef.current?.requestSubmit()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const update = (id: string, fn: (r: RowState) => RowState) =>
    setRows((prev) => ({ ...prev, [id]: fn(prev[id]) }))

  const setCount = (id: string, code: string, raw: string) => {
    const digits = raw.replace(/\D/g, '').slice(0, 6)
    update(id, (r) => {
      // An emptied box drops its key, so typing a number and deleting it again
      // leaves the row exactly as it was — not "changed, not saved".
      const counts = { ...r.counts }
      if (digits === '') delete counts[code]
      else counts[code] = digits
      return {
        ...r,
        // Typing a number for somebody not yet marked means they were here.
        // One fewer tap per person, on the common path.
        attendance: r.attendance === null && digits !== '' ? 'present' : r.attendance,
        counts,
      }
    })
  }

  const markRemainingPresent = () =>
    setRows((prev) =>
      Object.fromEntries(
        Object.entries(prev).map(([id, r]) => [id, r.attendance === null ? { ...r, attendance: 'present' } : r]),
      ),
    )

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (readOnly || pending || !dirty) return

    // A note for somebody with no attendance would be skipped by the save —
    // say so now rather than let it vanish. (Counts and flags already mark
    // the person present as they are typed.)
    const unmarked = people.find((p) => changedIds.includes(p.id) && rows[p.id].attendance === null)
    if (unmarked) {
      onResult({ tone: 'error', text: `Mark attendance for ${unmarked.name} before saving their note.` })
      return
    }

    const input: SheetInput = {
      date,
      entries: changedIds.map((id) => {
        const r = rows[id]
        const working = canHaveWork(r.attendance)
        return {
          staff_id: id,
          attendance: r.attendance,
          note: r.note.trim() || null,
          // Every task, so a cleared box zeroes what was there. Absent or on
          // leave sends none: the numbers stay on screen in case the tap was a
          // mistake, but they are not saved against a day off.
          counts: Object.fromEntries(
            tasks.map((t) => {
              const v = r.counts[t.code] ?? ''
              return [t.code, working && v !== '' ? Number(v) : null]
            }),
          ),
          add_flags: r.newFlags.map((f) => ({
            kind: f.kind,
            order_ref: f.orderRef.trim() || null,
            note: f.note.trim() || null,
          })),
          remove_flag_ids: r.removed,
        }
      }),
    }

    startTransition(async () => {
      const result = await saveStaffSheet(input)
      if (result.ok) {
        onDirtyChange(false)
        onResult({
          tone: 'success',
          text: `Saved. ${marked} of ${people.length} people recorded for this day.`,
        })
      } else {
        onResult({ tone: 'error', text: result.message })
      }
    })
  }

  if (people.length === 0) {
    return (
      <Alert>
        Nobody is on the roster for this day yet. Add the floor staff below, then fill in their day.
      </Alert>
    )
  }

  return (
    <form ref={formRef} onSubmit={submit} className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-stone-600">
          <span className="font-medium tabular-nums text-stone-900">{marked}</span> of{' '}
          <span className="tabular-nums">{people.length}</span> marked
        </p>
        {!readOnly && marked < people.length && (
          <Button type="button" variant="secondary" onClick={markRemainingPresent} className="min-h-12">
            Mark everyone else present
          </Button>
        )}
      </div>

      <fieldset disabled={readOnly || pending} className="space-y-3">
        {people.map((p) => {
          const r = rows[p.id]
          const working = canHaveWork(r.attendance)
          return (
            <section
              key={p.id}
              aria-label={p.name}
              className={cn(
                'rounded-xl border bg-white p-3 shadow-sm sm:p-4',
                r.attendance === null ? 'border-amber-300 border-l-4' : 'border-stone-200',
              )}
            >
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <h2 className="min-w-28 flex-1 text-base font-medium text-stone-900">{p.name}</h2>

                {/*
                  * Native radios, styled as buttons: one tab stop per person,
                  * arrow keys move between the four, and a tablet gets
                  * 48px targets.
                  */}
                <div role="radiogroup" aria-label={`${p.name} attendance`} className="flex gap-1.5">
                  {ATTENDANCE.map((a) => (
                    <label key={a.value} className="cursor-pointer">
                      <input
                        type="radio"
                        name={`attendance-${p.id}`}
                        value={a.value}
                        checked={r.attendance === a.value}
                        onChange={() => update(p.id, (row) => ({ ...row, attendance: a.value }))}
                        className="peer sr-only"
                      />
                      <span
                        className={cn(
                          'flex min-h-12 min-w-16 items-center justify-center rounded-lg border px-2 text-sm font-medium select-none',
                          'border-stone-300 bg-white text-stone-700',
                          'peer-focus-visible:ring-2 peer-focus-visible:ring-stone-900 peer-focus-visible:ring-offset-1',
                          a.value === 'present' && 'peer-checked:border-emerald-600 peer-checked:bg-emerald-600 peer-checked:text-white',
                          a.value === 'half_day' && 'peer-checked:border-amber-500 peer-checked:bg-amber-500 peer-checked:text-white',
                          a.value === 'absent' && 'peer-checked:border-red-600 peer-checked:bg-red-600 peer-checked:text-white',
                          a.value === 'leave' && 'peer-checked:border-sky-600 peer-checked:bg-sky-600 peer-checked:text-white',
                        )}
                      >
                        {a.label}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-8">
                {tasks.map((t) => (
                  <label key={t.code} className="block">
                    <span className="block truncate text-xs text-stone-500">{t.label}</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      autoComplete="off"
                      value={r.counts[t.code] ?? ''}
                      onChange={(e) => setCount(p.id, t.code, e.target.value)}
                      disabled={r.attendance !== null && !working}
                      aria-label={`${p.name} ${t.label}`}
                      className={cn(
                        'mt-0.5 min-h-12 w-full rounded-lg border border-stone-300 bg-white px-2 text-center text-lg tabular-nums',
                        'focus:border-stone-500 focus:outline-none focus:ring-1 focus:ring-stone-500',
                        'disabled:bg-stone-100 disabled:text-stone-400 disabled:line-through',
                      )}
                    />
                  </label>
                ))}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={r.note}
                  maxLength={280}
                  onChange={(e) => update(p.id, (row) => ({ ...row, note: e.target.value }))}
                  placeholder="Note (optional)"
                  aria-label={`${p.name} note`}
                  className="min-h-11 min-w-48 flex-1 rounded-lg border border-stone-300 bg-white px-3 text-base placeholder:text-stone-400 focus:border-stone-500 focus:outline-none focus:ring-1 focus:ring-stone-500"
                />
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() =>
                    update(p.id, (row) => ({
                      ...row,
                      // Flagging a problem for somebody not yet marked implies
                      // they were in, same as typing a count.
                      attendance: row.attendance ?? 'present',
                      newFlags: [...row.newFlags, { key: nextFlagKey.current++, kind: 'wrong_item', orderRef: '', note: '' }],
                    }))
                  }
                  disabled={r.attendance !== null && !working}
                  className="border border-dashed border-stone-300"
                >
                  <Flag className="size-4" /> Flag a problem
                </Button>
              </div>

              {(p.flags.length > 0 || r.newFlags.length > 0) && (
                <ul className="mt-3 space-y-2">
                  {p.flags.map((f) => {
                    const removed = r.removed.includes(f.id)
                    return (
                      <li
                        key={f.id}
                        className={cn(
                          'flex flex-wrap items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-900',
                          removed && 'bg-stone-100 text-stone-400 line-through',
                        )}
                      >
                        <Flag className="size-4 shrink-0" />
                        <span className="font-medium">{FLAG_KINDS.find((k) => k.value === f.kind)?.label}</span>
                        {f.orderRef && <span className="font-mono">{f.orderRef}</span>}
                        {f.note && <span className="min-w-0 flex-1 truncate">{f.note}</span>}
                        <button
                          type="button"
                          onClick={() =>
                            update(p.id, (row) => ({
                              ...row,
                              removed: removed ? row.removed.filter((x) => x !== f.id) : [...row.removed, f.id],
                            }))
                          }
                          className="ml-auto min-h-9 rounded px-2 text-xs font-medium text-stone-600 no-underline hover:bg-white"
                        >
                          {removed ? 'Undo' : 'Withdraw'}
                        </button>
                      </li>
                    )
                  })}

                  {r.newFlags.map((f) => (
                    <li key={f.key} className="space-y-2 rounded-lg border border-red-200 bg-red-50/50 p-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {FLAG_KINDS.map((k) => (
                          <button
                            key={k.value}
                            type="button"
                            aria-pressed={f.kind === k.value}
                            onClick={() =>
                              update(p.id, (row) => ({
                                ...row,
                                newFlags: row.newFlags.map((x) => (x.key === f.key ? { ...x, kind: k.value } : x)),
                              }))
                            }
                            className={cn(
                              'min-h-10 rounded-lg border px-3 text-sm',
                              f.kind === k.value
                                ? 'border-red-700 bg-red-700 text-white'
                                : 'border-stone-300 bg-white text-stone-700',
                            )}
                          >
                            {k.label}
                          </button>
                        ))}
                        <button
                          type="button"
                          aria-label="Discard this flag"
                          onClick={() =>
                            update(p.id, (row) => ({ ...row, newFlags: row.newFlags.filter((x) => x.key !== f.key) }))
                          }
                          className="ml-auto inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg text-stone-500 hover:bg-white"
                        >
                          <X className="size-4" />
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <input
                          type="text"
                          value={f.orderRef}
                          maxLength={60}
                          placeholder="Order no. (optional)"
                          aria-label="Order reference"
                          onChange={(e) =>
                            update(p.id, (row) => ({
                              ...row,
                              newFlags: row.newFlags.map((x) => (x.key === f.key ? { ...x, orderRef: e.target.value } : x)),
                            }))
                          }
                          className="min-h-11 w-44 rounded-lg border border-stone-300 bg-white px-3 font-mono text-base"
                        />
                        <input
                          type="text"
                          value={f.note}
                          maxLength={280}
                          placeholder="What happened (optional)"
                          aria-label="Flag note"
                          onChange={(e) =>
                            update(p.id, (row) => ({
                              ...row,
                              newFlags: row.newFlags.map((x) => (x.key === f.key ? { ...x, note: e.target.value } : x)),
                            }))
                          }
                          className="min-h-11 min-w-48 flex-1 rounded-lg border border-stone-300 bg-white px-3 text-base"
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )
        })}
      </fieldset>

      {!readOnly && (
        <div
          className="fixed inset-x-0 bottom-0 z-20 border-t border-stone-200 bg-white/95 px-4 py-3 backdrop-blur"
          style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
        >
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
            <p className="text-sm text-stone-600" aria-live="polite">
              {pending
                ? 'Saving…'
                : dirty
                  ? `${changedIds.length} ${changedIds.length === 1 ? 'person' : 'people'} changed, not saved`
                  : 'Nothing to save'}
            </p>
            <Button type="submit" disabled={!dirty || pending} className="min-h-12 min-w-40 text-base">
              {pending ? 'Saving…' : 'Save sheet'}
            </Button>
          </div>
        </div>
      )}
    </form>
  )
}
