'use client'

import { useCallback, useId, useRef, useState, useTransition, type KeyboardEvent, type ReactNode } from 'react'
import { AlertTriangle, Plus, X } from 'lucide-react'
import { cn } from '@/components/ui/primitives'
import {
  COMMON_REASONS,
  formatSigned,
  movementFigures,
  movementIsSettled,
  needsAnswer,
  splitMovements,
  splitPastedSkus,
  type MovementDefinition,
  type MovementRow,
} from '@/lib/day-sheet/calc'

/**
 * One movement, laid out exactly as the notebook page lays it out: the two
 * counted boxes and the difference across the top, then the sarees themselves,
 * then what is still unaccounted for.
 *
 * THE GRID IS THE THREE LISTS. The page draws "sarees that did not come back",
 * "offline sarees sold" and "overall diff" as three separate columns, because on
 * paper a saree has to be copied into each one. Here they are three readings of
 * the same line — tick "came back" and it leaves the first list, tick "sold" and
 * it moves from the third to the second — so a code is written once and the
 * three counts under the grid are always the counts of what is above them.
 *
 * KEYBOARD. The manager stands at the bench with a stack of sarees and a
 * tablet, and every round trip to the mouse costs a saree put down. So: type a
 * code, Enter, the line commits and the cursor stays where it was for the next
 * one. Arrow keys move between cells like a spreadsheet, Tab moves along a row,
 * Space ticks the box under the cursor. Nothing here needs a pointer.
 */

const COLUMNS = {
  sku: 0,
  wentOut: 1,
  cameBack: 2,
  soldOffline: 3,
  billNo: 4,
  reason: 5,
  who: 6,
  remove: 7,
} as const

const LAST_COLUMN = COLUMNS.remove

/** The one place the column widths are written down. */
const ROW_GRID =
  'grid min-w-[42rem] grid-cols-[1.75rem_minmax(8rem,1.2fr)_repeat(3,2.75rem)_minmax(5rem,0.6fr)_minmax(8rem,1.1fr)_minmax(5.5rem,0.6fr)_2.5rem] items-center gap-x-1.5'

export interface MovementSectionProps {
  definition: MovementDefinition
  rows: MovementRow[]
  /** The two counted boxes, held as text so a half-typed figure is not a zero. */
  out: string
  back: string
  onTotalChange: (which: 'out' | 'back', value: string) => void
  /** Commit the counted boxes. Called when one loses focus. */
  onTotalCommit: () => void
  onAdd: (sku: string) => Promise<boolean>
  onPatch: (id: string, patch: Partial<MovementRow>) => void
  onRemove: (id: string) => void
  readOnly: boolean
  /** Names off the floor-staff roster, for the "who" column. */
  people: readonly string[]
  /** Rendered under the figures. The video-call section's own order count. */
  extra?: ReactNode
  /**
   * True when the reconciliation is shown beside the grid rather than under it.
   * The three tallies and the "what still needs an answer" lines then live in
   * the rail, and repeating them here would put the same four numbers on screen
   * twice — which teaches people that neither is the real one.
   */
  summaryInRail?: boolean
}

export function MovementSection({
  definition,
  rows,
  out,
  back,
  onTotalChange,
  onTotalCommit,
  onAdd,
  onPatch,
  onRemove,
  readOnly,
  people,
  extra,
  summaryInRail = false,
}: MovementSectionProps) {
  const gridRef = useRef<HTMLDivElement>(null)
  const addRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState('')
  const [adding, startAdding] = useTransition()
  const reasonListId = useId()
  const peopleListId = useId()

  const split = splitMovements(rows)
  const figures = movementFigures(Number(out || 0), Number(back || 0), split)
  const settled = movementIsSettled(figures, split)

  /**
   * Move the cursor to a cell, falling back leftwards when that column does not
   * exist on that line — the line at the bottom has only a code box, so
   * pressing Down from the "who" column lands on it rather than nowhere.
   */
  const focusCell = useCallback((row: number, column: number): boolean => {
    const grid = gridRef.current
    if (!grid || row < 0) return false
    for (let c = Math.min(column, LAST_COLUMN); c >= 0; c--) {
      const el = grid.querySelector<HTMLElement>(`[data-cell="${row},${c}"]`)
      if (!el || el.hasAttribute('disabled')) continue
      el.focus()
      if (el instanceof HTMLInputElement && el.type === 'text') el.select()
      return true
    }
    return false
  }, [])

  const onGridKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const cell = (e.target as HTMLElement).closest<HTMLElement>('[data-cell]')
    if (!cell || e.altKey || e.metaKey) return

    const [row, column] = (cell.dataset.cell ?? '').split(',').map(Number)
    if (Number.isNaN(row) || Number.isNaN(column)) return

    // Inside a text box the caret has first claim on left and right: they only
    // leave the cell once there is nowhere left to go inside it.
    const text = cell instanceof HTMLInputElement && cell.type === 'text' ? cell : null
    const collapsed = text ? text.selectionStart === text.selectionEnd : true
    const atStart = text ? collapsed && text.selectionStart === 0 : true
    const atEnd = text ? collapsed && text.selectionStart === text.value.length : true

    const go = (r: number, c: number) => {
      if (focusCell(r, c)) e.preventDefault()
    }

    switch (e.key) {
      case 'ArrowDown':
        return go(row + 1, column)
      case 'ArrowUp':
        return go(row - 1, column)
      case 'ArrowRight':
        return atEnd ? go(row, column + 1) : undefined
      case 'ArrowLeft':
        return atStart ? go(row, column - 1) : undefined
      case 'Home':
        return e.ctrlKey ? go(0, column) : atStart ? go(row, 0) : undefined
      case 'End':
        return e.ctrlKey ? go(rows.length, column) : atEnd ? go(row, LAST_COLUMN) : undefined
      case 'Enter':
        // The line at the bottom has its own Enter: it writes a saree down.
        return row < rows.length ? go(row + 1, column) : undefined
    }
  }

  const commitDraft = (value: string) => {
    const codes = splitPastedSkus(value)
    if (codes.length === 0 || adding) return
    startAdding(async () => {
      for (const sku of codes) {
        const added = await onAdd(sku)
        // A refusal keeps the code in the box so it can be corrected rather
        // than retyped from the label.
        if (!added) {
          setDraft(sku)
          return
        }
      }
      setDraft('')
      addRef.current?.focus()
    })
  }

  return (
    <section aria-labelledby={`movement-${definition.kind}`} className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 id={`movement-${definition.kind}`} className="text-base font-medium text-stone-900">
          {definition.label}
        </h3>
        {!summaryInRail && (
          <p className={cn('text-sm', settled ? 'text-emerald-700' : 'text-amber-800')}>
            {settled
              ? 'Everything is accounted for.'
              : `${Math.max(figures.stillToExplain, 0)} still to explain`}
          </p>
        )}
      </div>

      {/* The three boxes across the top of the notebook page. */}
      <div className="grid gap-2 sm:grid-cols-3">
        <CountBox
          label={definition.outLabel}
          value={out}
          onChange={(v) => onTotalChange('out', v)}
          onCommit={onTotalCommit}
          readOnly={readOnly}
        />
        <CountBox
          label={definition.backLabel}
          value={back}
          onChange={(v) => onTotalChange('back', v)}
          onCommit={onTotalCommit}
          readOnly={readOnly}
        />
        <div className="rounded-xl border border-stone-300 bg-stone-50 px-3 py-2">
          <p className="text-xs text-stone-600">Difference</p>
          <p
            className={cn(
              'mt-1 text-2xl leading-8 font-medium tabular-nums',
              figures.difference === 0 ? 'text-stone-900' : 'text-amber-900',
            )}
          >
            {formatSigned(figures.difference)}
          </p>
          <p className="mt-0.5 text-xs text-stone-500">Worked out, not typed</p>
        </div>
      </div>

      {extra}

      {/* The sarees. One line each; the three lists are read off them below. */}
      <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
        <div ref={gridRef} onKeyDown={onGridKeyDown} className="min-w-[42rem]">
          <div
            aria-hidden
            className={cn(
              ROW_GRID,
              'border-b border-stone-200 bg-stone-50 px-2 py-1.5 text-xs text-stone-500',
            )}
          >
            <span />
            <span>Saree</span>
            <span className="text-center">Out</span>
            <span className="text-center">Back</span>
            <span className="text-center">Sold</span>
            <span>Bill no.</span>
            <span>Reason</span>
            <span>Who</span>
            <span />
          </div>

          <ul>
            {rows.map((row, index) => (
              <MovementLine
                key={row.id}
                row={row}
                index={index}
                readOnly={readOnly}
                reasonListId={reasonListId}
                peopleListId={peopleListId}
                onPatch={onPatch}
                onRemove={onRemove}
              />
            ))}
          </ul>

          {/*
            * The line at the bottom, which is where the whole screen is used
            * from: type, Enter, type, Enter. It never moves and never
            * disappears, so the cursor has one home.
            */}
          {!readOnly && (
            <div className={cn(ROW_GRID, 'border-t border-stone-200 px-2 py-1.5')}>
              <Plus aria-hidden className="size-4 text-stone-400" />
              <input
                ref={addRef}
                type="text"
                data-cell={`${rows.length},0`}
                value={draft}
                disabled={adding}
                maxLength={120}
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                aria-label={`Write a saree down under ${definition.label}`}
                placeholder="Type a code, press Enter"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    commitDraft(draft)
                  } else if (e.key === 'Escape') {
                    setDraft('')
                  }
                }}
                onPaste={(e) => {
                  const pasted = e.clipboardData.getData('text')
                  // A column copied out of a spreadsheet arrives with newlines
                  // in it. One paste, one line each, rather than one line
                  // containing the whole column.
                  if (!/[\r\n\t,;]/.test(pasted)) return
                  e.preventDefault()
                  commitDraft(pasted)
                }}
                className="col-span-4 min-h-11 rounded-lg border border-dashed border-stone-300 bg-white px-2 font-mono text-base placeholder:font-sans placeholder:text-stone-400 focus:border-stone-500 focus:ring-1 focus:ring-stone-500 focus:outline-none disabled:bg-stone-50"
              />
              <p className="col-span-4 px-2 text-xs text-stone-500" aria-live="polite">
                {adding ? 'Writing it down…' : `${rows.length} written down`}
              </p>
            </div>
          )}
        </div>
      </div>

      <datalist id={reasonListId}>
        {COMMON_REASONS.map((r) => (
          <option key={r} value={r} />
        ))}
      </datalist>
      <datalist id={peopleListId}>
        {people.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>

      {!summaryInRail && (
        <>
      {/* The notebook's three lists, as the counts of what is in the grid. */}
      <dl className="grid grid-cols-3 gap-2 text-sm">
        <Tally label="Did not come back" value={split.notBack.length} />
        <Tally label="Sold offline" value={split.soldOffline.length} />
        <Tally
          label="Still to explain"
          value={figures.stillToExplain}
          tone={figures.stillToExplain === 0 ? 'settled' : 'open'}
        />
      </dl>

      {(figures.unlisted !== 0 || split.unanswered.length > 0) && (
        <ul className="space-y-1 text-sm text-amber-900">
          {figures.unlisted > 0 && (
            <li>
              {figures.unlisted} {figures.unlisted === 1 ? 'saree has' : 'sarees have'} not been written
              down yet — the counts say {figures.difference} did not come back and {split.notBack.length}{' '}
              {split.notBack.length === 1 ? 'is' : 'are'} on the list.
            </li>
          )}
          {figures.unlisted < 0 && (
            <li>
              There {Math.abs(figures.unlisted) === 1 ? 'is' : 'are'} {Math.abs(figures.unlisted)} more
              {Math.abs(figures.unlisted) === 1 ? ' line' : ' lines'} here than the two counts allow.
              Check the boxes above, or tick the ones that came back.
            </li>
          )}
          {split.unanswered.length > 0 && (
            <li>
              {split.unanswered.length} still {split.unanswered.length === 1 ? 'needs' : 'need'} a reason:{' '}
              <span className="font-mono">{split.unanswered.map((r) => r.sku).join(', ')}</span>
            </li>
          )}
        </ul>
      )}
        </>
      )}

    </section>
  )
}

function Tally({ label, value, tone }: { label: string; value: number; tone?: 'settled' | 'open' }) {
  return (
    <div className="rounded-lg border border-stone-200 px-3 py-2">
      <dt className="text-xs text-stone-600">{label}</dt>
      <dd
        className={cn(
          'text-lg font-medium tabular-nums',
          tone === 'open' && 'text-amber-900',
          tone === 'settled' && 'text-emerald-800',
          !tone && 'text-stone-900',
        )}
      >
        {formatSigned(value)}
      </dd>
    </div>
  )
}

function CountBox({
  label,
  value,
  onChange,
  onCommit,
  readOnly,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  onCommit: () => void
  readOnly: boolean
}) {
  return (
    <label className="block rounded-xl border border-stone-200 bg-white px-3 py-2">
      <span className="block text-xs text-stone-600">{label}</span>
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        value={value}
        disabled={readOnly}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
        onBlur={onCommit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            e.currentTarget.blur()
          }
        }}
        className="mt-0.5 w-full rounded-lg text-2xl leading-8 font-medium tabular-nums focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-900 disabled:text-stone-500"
      />
    </label>
  )
}

/**
 * One saree.
 *
 * Text cells keep their own copy while they are being typed into and send it
 * once, when the cursor leaves: a reason is a sentence, and posting it letter
 * by letter would be forty writes for one answer. The ticks send immediately —
 * they are the whole reason somebody has come back to this screen.
 */
function MovementLine({
  row,
  index,
  readOnly,
  reasonListId,
  peopleListId,
  onPatch,
  onRemove,
}: {
  row: MovementRow
  index: number
  readOnly: boolean
  reasonListId: string
  peopleListId: string
  onPatch: (id: string, patch: Partial<MovementRow>) => void
  onRemove: (id: string) => void
}) {
  const wanting = needsAnswer(row)

  return (
    <li
      className={cn(
        ROW_GRID,
        'border-b border-stone-100 px-2 py-1 last:border-b-0',
        wanting && 'bg-amber-50/70',
        row.cameBack && 'bg-stone-50/60',
      )}
    >
      <span className="text-right text-xs text-stone-500 tabular-nums">{index + 1}</span>

      <span className="relative">
        <input
          type="text"
          data-cell={`${index},${COLUMNS.sku}`}
          defaultValue={row.sku}
          key={row.sku}
          disabled={readOnly}
          maxLength={120}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          aria-label={`Code, line ${index + 1}`}
          onBlur={(e) => {
            const next = e.target.value
            if (next.trim() !== '' && next !== row.sku) onPatch(row.id, { sku: next })
            else e.target.value = row.sku
          }}
          className={cn(
            'min-h-11 w-full rounded-lg border border-transparent bg-transparent px-2 font-mono text-base text-stone-900',
            'hover:border-stone-200 focus:border-stone-500 focus:bg-white focus:ring-1 focus:ring-stone-500 focus:outline-none',
            row.known === false && 'pr-8',
          )}
        />
        {row.known === false && (
          <span
            title="No saree with this code is in the catalogue. It is written down all the same."
            className="pointer-events-none absolute inset-y-0 right-1.5 flex items-center text-amber-600"
          >
            <AlertTriangle aria-hidden className="size-4" />
            <span className="sr-only">Not in the catalogue</span>
          </span>
        )}
      </span>

      <Tick
        cell={`${index},${COLUMNS.wentOut}`}
        label={`${row.sku} went out`}
        checked={row.wentOut}
        disabled={readOnly}
        onChange={(v) => onPatch(row.id, { wentOut: v })}
      />
      <Tick
        cell={`${index},${COLUMNS.cameBack}`}
        label={`${row.sku} came back`}
        checked={row.cameBack}
        disabled={readOnly}
        tone="good"
        onChange={(v) => onPatch(row.id, { cameBack: v })}
      />
      <Tick
        cell={`${index},${COLUMNS.soldOffline}`}
        label={`${row.sku} sold offline`}
        checked={row.soldOffline}
        disabled={readOnly}
        tone="sold"
        onChange={(v) => onPatch(row.id, { soldOffline: v })}
      />

      <CellInput
        cell={`${index},${COLUMNS.billNo}`}
        label={`Bill number for ${row.sku}`}
        value={row.billNo}
        placeholder={row.soldOffline ? 'Bill no.' : '—'}
        maxLength={60}
        disabled={readOnly}
        mono
        onCommit={(v) => onPatch(row.id, { billNo: v })}
      />
      <CellInput
        cell={`${index},${COLUMNS.reason}`}
        label={`Reason for ${row.sku}`}
        value={row.reason}
        placeholder={wanting ? 'Why? — needed' : 'Why?'}
        maxLength={400}
        disabled={readOnly}
        listId={reasonListId}
        invalid={wanting}
        onCommit={(v) => onPatch(row.id, { reason: v })}
      />
      <CellInput
        cell={`${index},${COLUMNS.who}`}
        label={`Who dealt with ${row.sku}`}
        value={row.who}
        placeholder="Who"
        maxLength={80}
        disabled={readOnly}
        listId={peopleListId}
        onCommit={(v) => onPatch(row.id, { who: v })}
      />

      {readOnly ? (
        <span />
      ) : (
        <button
          type="button"
          data-cell={`${index},${COLUMNS.remove}`}
          aria-label={`Take ${row.sku} off this day`}
          onClick={() => {
            if (window.confirm(`Take ${row.sku} off this day?`)) onRemove(row.id)
          }}
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-stone-500 hover:bg-stone-100 hover:text-stone-700 focus-visible:ring-2 focus-visible:ring-stone-900 focus-visible:outline-none"
        >
          <X aria-hidden className="size-4" />
        </button>
      )}
    </li>
  )
}

/**
 * A tick box the size of a thumb.
 *
 * A native checkbox, hidden but focused and toggled exactly as one — Space
 * ticks it, a screen reader announces it — with the visible square drawn on the
 * label beside it at 44px. The tick itself is never the only signal: the row
 * tints, and the counts under the grid move.
 */
function Tick({
  cell,
  label,
  checked,
  disabled,
  tone,
  onChange,
}: {
  cell: string
  label: string
  checked: boolean
  disabled: boolean
  tone?: 'good' | 'sold'
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-center justify-center">
      <input
        type="checkbox"
        data-cell={cell}
        checked={checked}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden
        className={cn(
          'flex size-11 items-center justify-center rounded-lg border text-lg leading-none select-none',
          'border-stone-300 bg-white text-transparent',
          'peer-focus-visible:ring-2 peer-focus-visible:ring-stone-900 peer-focus-visible:ring-offset-1',
          'peer-disabled:bg-stone-100',
          checked && !tone && 'border-stone-800 bg-stone-800 text-white',
          checked && tone === 'good' && 'border-emerald-700 bg-emerald-700 text-white',
          checked && tone === 'sold' && 'border-sky-700 bg-sky-700 text-white',
        )}
      >
        ✓
      </span>
    </label>
  )
}

function CellInput({
  cell,
  label,
  value,
  placeholder,
  maxLength,
  disabled,
  listId,
  mono,
  invalid,
  onCommit,
}: {
  cell: string
  label: string
  value: string
  placeholder: string
  maxLength: number
  disabled: boolean
  listId?: string
  mono?: boolean
  invalid?: boolean
  onCommit: (value: string) => void
}) {
  return (
    <input
      type="text"
      data-cell={cell}
      // Keyed on the saved value, so a row corrected elsewhere reappears with
      // the new text rather than keeping whatever this box last held.
      key={value}
      defaultValue={value}
      disabled={disabled}
      maxLength={maxLength}
      list={listId}
      autoComplete="off"
      aria-label={label}
      aria-invalid={invalid || undefined}
      placeholder={placeholder}
      onBlur={(e) => {
        if (e.target.value !== value) onCommit(e.target.value)
      }}
      className={cn(
        'min-h-11 w-full rounded-lg border border-transparent bg-transparent px-2 text-base text-stone-900',
        'hover:border-stone-200 focus:border-stone-500 focus:bg-white focus:ring-1 focus:ring-stone-500 focus:outline-none',
        'placeholder:text-stone-400 disabled:text-stone-500',
        mono && 'font-mono',
        invalid && 'placeholder:text-amber-700',
      )}
    />
  )
}
