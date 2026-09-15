import Link from 'next/link'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * The building blocks of the two home dashboards.
 *
 * A tile is a number and the one place to go and act on it. Every tile is a
 * link, because a dashboard number nobody can click is a number somebody has to
 * go and find again. Tone follows the colour vocabulary in primitives.tsx:
 * amber means someone is waiting, red means it stopped, neutral means fine.
 */

export type TileTone = 'neutral' | 'waiting' | 'bad' | 'good'

export function Tile({
  href,
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  href: string
  label: string
  value: number | string
  hint?: string
  tone?: TileTone
}) {
  return (
    <Link
      href={href}
      className={cn(
        'block rounded-xl border p-4 transition-colors',
        tone === 'neutral' && 'border-stone-200 hover:border-stone-300',
        tone === 'good' && 'border-emerald-200 bg-emerald-50/60 hover:border-emerald-300',
        tone === 'waiting' && 'border-amber-200 bg-amber-50/60 hover:border-amber-300',
        tone === 'bad' && 'border-red-200 bg-red-50/60 hover:border-red-300',
      )}
    >
      <p className="text-xs text-stone-500">{label}</p>
      <p className="mt-1 text-2xl font-medium tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-stone-500">{hint}</p>}
    </Link>
  )
}

/** A tone that only turns on when there is something to do. */
export function toneWhen(count: number, tone: TileTone): TileTone {
  return count > 0 ? tone : 'neutral'
}

export function DashboardSection({
  title,
  action,
  children,
}: {
  title: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium text-stone-500">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

export function TileGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{children}</div>
}

/**
 * What a section shows when its query failed.
 *
 * Not a zero. Every loader behind these dashboards throws on error precisely so
 * that "0 errors" can only ever mean zero errors; a section that could not load
 * says so, and the rest of the dashboard still renders.
 */
export function SectionError({ message }: { message: string }) {
  return (
    <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
      Could not load this section: {message}
    </p>
  )
}

/** Runs a loader and turns a failure into a value, so one section cannot blank the page. */
export async function settle<T>(load: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    return { ok: true, value: await load() }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
