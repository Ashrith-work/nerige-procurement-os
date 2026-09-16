'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { switchWorkspace } from '@/app/(app)/profiles/actions'

/**
 * The control that says which job you are doing, and changes it.
 *
 * Top right, in the same place on every screen, because it is the one control
 * that changes what all the others are. It shows the workspace's name rather
 * than an icon: the whole point is that a person can tell at a glance which of
 * their three jobs the screen in front of them is arranged for.
 *
 * Switching lands on the new workspace's first section — the work itself, not a
 * hub. A switch that dropped you on the same screen you were already looking at
 * would leave someone wondering whether it had done anything.
 *
 * A native <details> rather than a hand-rolled popover: it closes on Escape,
 * is reachable by keyboard and works before hydration.
 */

export interface SwitcherWorkspace {
  key: string
  name: string
  blurb: string
  home: string
  isActive: boolean
}

export function WorkspaceSwitcher({ workspaces, active }: { workspaces: SwitcherWorkspace[]; active: SwitcherWorkspace | null }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDetailsElement>(null)

  // Click anywhere else closes it. Without this the panel stays open behind the
  // next thing you do, over content it is covering.
  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  if (!active) return null

  return (
    <details
      ref={box}
      open={open}
      onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}
      className="relative"
    >
      <summary
        className={cn(
          'flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg px-3 text-sm',
          'hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-900',
          '[&::-webkit-details-marker]:hidden',
        )}
        aria-label={`Workspace: ${active.name}. Change workspace`}
      >
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-stone-900 text-xs font-medium text-white">
          {initials(active.name)}
        </span>
        <span className="hidden font-medium text-stone-900 sm:block">{active.name}</span>
        <svg viewBox="0 0 12 12" aria-hidden className="h-3 w-3 text-stone-400">
          <path d="M2 4.5 6 8.5 10 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </summary>

      <div className="absolute right-0 z-50 mt-1 w-72 overflow-hidden rounded-xl border border-stone-200 bg-white shadow-lg">
        <p className="px-4 pt-3 pb-1 text-xs text-stone-500">What are you doing?</p>

        <ul className="py-1">
          {workspaces.map((w) => (
            <li key={w.key}>
              <form action={switchWorkspace}>
                <input type="hidden" name="key" value={w.key} />
                <input type="hidden" name="to" value={w.home} />
                <button
                  type="submit"
                  className={cn(
                    'flex w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-stone-50',
                    w.isActive && 'bg-stone-50',
                  )}
                >
                  <span
                    className={cn(
                      'mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md text-xs font-medium',
                      w.isActive ? 'bg-stone-900 text-white' : 'bg-stone-100 text-stone-600',
                    )}
                  >
                    {initials(w.name)}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-stone-900">{w.name}</span>
                    <span className="block text-xs text-stone-500">{w.blurb}</span>
                  </span>
                </button>
              </form>
            </li>
          ))}
        </ul>

        <Link
          href="/profiles"
          onClick={() => setOpen(false)}
          className="block border-t border-stone-100 px-4 py-2.5 text-sm text-stone-600 hover:bg-stone-50"
        >
          Manage workspaces
        </Link>
      </div>
    </details>
  )
}

/** Two letters, so a switcher collapsed to an icon on a phone still identifies itself. */
function initials(name: string): string {
  const words = name.trim().split(/\s+/)
  const letters = words.length > 1 ? words[0][0] + words[1][0] : name.slice(0, 2)
  return letters.toUpperCase()
}
