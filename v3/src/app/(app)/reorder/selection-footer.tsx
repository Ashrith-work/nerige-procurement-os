'use client'

import Link from 'next/link'
import { useSelection } from '@/lib/reorder/selection'

/**
 * The running total, and the one button.
 *
 * The split by vendor is the point: Pooja is making a single decision and the
 * footer shows her, live, that it will land as three separate orders. Seeing
 * "HDR 6 · PGW 5 · SMT 3" before she presses send is what makes the split
 * something she chose rather than something the system did to her.
 */
export function SelectionFooter() {
  const { items, byVendor, clear, ready } = useSelection()

  if (!ready || items.length === 0) return null

  const vendors = byVendor.length

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-stone-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-stone-900">
            <span className="font-medium tabular-nums">{items.length} selected</span>
            <span className="text-stone-400"> · </span>
            <span className="text-stone-600 tabular-nums">
              {byVendor.map((v) => `${v.vendorCode} ${v.count}`).join(' · ')}
            </span>
          </p>
          <button
            type="button"
            onClick={clear}
            className="text-xs text-stone-500 underline underline-offset-2"
          >
            Clear
          </button>
        </div>

        <Link
          href="/reorder/review"
          className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg bg-stone-900 px-4 text-sm font-medium text-white hover:bg-stone-800"
        >
          Send to {vendors} {vendors === 1 ? 'vendor' : 'vendors'}
        </Link>
      </div>
    </div>
  )
}
