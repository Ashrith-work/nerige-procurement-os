'use client'

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import {
  MOVEMENTS,
  movementFigures,
  movementIsSettled,
  splitMovements,
  type MovementKind,
  type MovementRow,
} from '@/lib/day-sheet/calc'

/**
 * The column that does not move: what the day adds up to, while he types.
 *
 * The notebook page has the counts at the top and the lists under them, because
 * paper cannot do two things at once. A screen can, and the reconciliation is
 * the reason this sheet exists — so it sits beside the grid rather than below
 * it, and the manager watches the difference close as he ticks sarees back in.
 * Nobody should have to scroll to find out whether the day balances.
 *
 * It is a READ-OUT, not a second set of inputs. The counted boxes live in the
 * grid on the left, where the counting happens; every figure here is worked out
 * from those two numbers and the lines beneath them.
 *
 * On a phone the rail stops being a rail — it stacks under the grid, still in
 * the same order, because a 320px column beside a 375px screen is neither.
 */
export function SummaryRail({
  active,
  rows,
  out,
  back,
  onJump,
  children,
}: {
  active: MovementKind
  rows: readonly MovementRow[]
  /** The counted boxes, as typed: a half-typed figure must not read as zero. */
  out: string
  back: string
  onJump: (kind: MovementKind) => void
  /** The orders and staff panels, rendered on the server and passed down. */
  children?: ReactNode
}) {
  return (
    <aside className="space-y-4 lg:sticky lg:top-4 lg:h-max" aria-label="What the day adds up to">
      {MOVEMENTS.map((definition) => {
        const kind = definition.kind
        const mine = rows.filter((r) => r.kind === kind)
        const split = splitMovements(mine)
        const figures = movementFigures(
          kind === active ? Number(out) || 0 : countedFor(rows, kind, 'out'),
          kind === active ? Number(back) || 0 : countedFor(rows, kind, 'back'),
          split,
        )
        const settled = movementIsSettled(figures, split)
        const isActive = kind === active

        // The two movements he is not in are one line each: enough to know
        // whether they need him, not enough to compete with the one he is on.
        if (!isActive) {
          return (
            <button
              key={kind}
              type="button"
              onClick={() => onJump(kind)}
              className={cn(
                'flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border px-3 text-left text-sm',
                'focus-visible:ring-2 focus-visible:ring-stone-900 focus-visible:ring-offset-2 focus-visible:outline-none',
                settled
                  ? 'border-stone-200 text-stone-600 hover:bg-stone-50'
                  : 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100',
              )}
            >
              <span className="font-medium">{definition.label}</span>
              <span className="tabular-nums">
                {settled ? 'settled' : `${Math.max(figures.stillToExplain, 0)} to explain`}
              </span>
            </button>
          )
        }

        return (
          <div key={kind} className="rounded-xl border border-stone-300 bg-white">
            <p className="border-b border-stone-200 px-3 py-2 text-sm font-medium text-stone-900">
              {definition.label}
            </p>
            <dl className="divide-y divide-stone-100 text-sm">
              <Figure label="Went out" value={figures.out} />
              <Figure label="Came back" value={figures.back} />
              <Figure label="Difference" value={figures.difference} tone={figures.difference === 0 ? 'calm' : 'warn'} />
              <Figure label="Sold offline" value={split.soldOffline.length} />
              <Figure
                label="Still to explain"
                value={Math.max(figures.stillToExplain, 0)}
                tone={figures.stillToExplain === 0 ? 'good' : 'bad'}
              />
            </dl>

            <div className="space-y-1.5 border-t border-stone-200 px-3 py-2 text-sm">
              {figures.unlisted > 0 && (
                <p className="text-amber-900">
                  {figures.unlisted} not written down yet — the counts say {figures.difference} did not come
                  back and {split.notBack.length} {split.notBack.length === 1 ? 'is' : 'are'} on the list.
                </p>
              )}
              {figures.unlisted < 0 && (
                <p className="text-amber-900">
                  {Math.abs(figures.unlisted)} more {Math.abs(figures.unlisted) === 1 ? 'line' : 'lines'} here
                  than the counts allow. Check the two boxes.
                </p>
              )}
              {split.unanswered.length > 0 ? (
                <p className="text-red-800">
                  {split.unanswered.length} {split.unanswered.length === 1 ? 'needs' : 'need'} a reason:{' '}
                  <span className="font-mono">{split.unanswered.map((r) => r.sku).join(', ')}</span>
                </p>
              ) : (
                settled && <p className="text-emerald-700">Everything is accounted for.</p>
              )}
            </div>
          </div>
        )
      })}

      {children}
    </aside>
  )
}

/**
 * The counted boxes of a movement he is not looking at.
 *
 * They live in the grid's own state, which is only mounted for the active
 * movement — so for the other two the honest answer is what the lines say, and
 * the summary line shows what still needs an answer rather than a difference it
 * cannot know. Returning 0 here keeps `movementFigures` total: the "to explain"
 * count it produces is driven by the lines, which is exactly what that one-line
 * summary claims to be about.
 */
function countedFor(rows: readonly MovementRow[], kind: MovementKind, which: 'out' | 'back'): number {
  const mine = rows.filter((r) => r.kind === kind)
  return which === 'out' ? mine.length : mine.filter((r) => r.cameBack).length
}

function Figure({
  label,
  value,
  tone = 'calm',
}: {
  label: string
  value: number
  tone?: 'calm' | 'warn' | 'good' | 'bad'
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-3 py-1.5">
      <dt className="text-stone-600">{label}</dt>
      <dd
        className={cn(
          'text-lg font-medium tabular-nums',
          tone === 'calm' && 'text-stone-900',
          tone === 'warn' && 'text-amber-800',
          tone === 'good' && 'text-emerald-700',
          tone === 'bad' && 'text-red-800',
        )}
      >
        {value}
      </dd>
    </div>
  )
}
