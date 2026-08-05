'use client'

import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react'

/**
 * What Pooja has tapped, held across the whole reorder flow.
 *
 * Selection has to survive changing the vendor picker, because the split at the
 * bottom of the screen — "14 selected · HDR 6 · PGW 5 · SMT 3" — is only
 * possible if she can browse one weaver, tap, then browse the next without
 * losing the first. The provider is mounted in the /reorder layout so it stays
 * alive across every navigation inside that segment, including the review step.
 *
 * sessionStorage is the store rather than a mirror of one: a reload part-way
 * through a long browse must not throw away twenty minutes of tapping, and
 * `useSyncExternalStore` is how React reads something it does not own without
 * a render-triggering effect. `getServerSnapshot` returns null rather than an
 * empty list, which is what lets callers tell "nothing selected" apart from
 * "not read yet" and avoids flashing an empty footer over a real selection.
 */

export interface Selected {
  sku: string
  vendorCode: string
  title: string | null
  imageUrl: string | null
  reason: 'sold_out' | 'last_piece' | null
}

const STORAGE_KEY = 'nerige.reorder.selection'

let cache: Selected[] | null = null
const listeners = new Set<() => void>()

/** Cached, because getSnapshot must return a stable reference between changes. */
function read(): Selected[] {
  if (cache) return cache
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    cache = raw ? (JSON.parse(raw) as Selected[]) : []
  } catch {
    // Private browsing, quota, corrupt value — not worth failing the screen for.
    cache = []
  }
  return cache
}

function write(next: Selected[]) {
  cache = next
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // The selection still works for this page.
  }
  for (const l of listeners) l()
}

function subscribe(onChange: () => void) {
  listeners.add(onChange)
  return () => {
    listeners.delete(onChange)
  }
}

interface SelectionApi {
  items: Selected[]
  /** False until the stored selection has been read on the client. */
  ready: boolean
  has: (sku: string) => boolean
  toggle: (design: Selected) => void
  remove: (sku: string) => void
  clear: () => void
  /** Live split by vendor, in descending count order. */
  byVendor: { vendorCode: string; count: number }[]
}

const SelectionContext = createContext<SelectionApi | null>(null)

export function SelectionProvider({ children }: { children: ReactNode }) {
  const stored = useSyncExternalStore<Selected[] | null>(
    subscribe,
    read,
    () => null,
  )

  const api = useMemo<SelectionApi>(() => {
    const items = stored ?? []
    const skus = new Set(items.map((i) => i.sku))
    const counts = new Map<string, number>()
    for (const i of items) counts.set(i.vendorCode, (counts.get(i.vendorCode) ?? 0) + 1)

    return {
      items,
      ready: stored !== null,
      has: (sku) => skus.has(sku),
      toggle: (design) =>
        write(
          items.some((i) => i.sku === design.sku)
            ? items.filter((i) => i.sku !== design.sku)
            : [...items, design],
        ),
      remove: (sku) => write(items.filter((i) => i.sku !== sku)),
      clear: () => write([]),
      byVendor: [...counts]
        .map(([vendorCode, count]) => ({ vendorCode, count }))
        .sort((a, b) => b.count - a.count || a.vendorCode.localeCompare(b.vendorCode)),
    }
  }, [stored])

  return <SelectionContext.Provider value={api}>{children}</SelectionContext.Provider>
}

export function useSelection(): SelectionApi {
  const ctx = useContext(SelectionContext)
  if (!ctx) throw new Error('useSelection must be used inside SelectionProvider')
  return ctx
}
