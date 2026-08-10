'use client'

import { useRouter } from 'next/navigation'
import { Input, Select, Button } from '@/components/ui/primitives'
import { availableSorts, SORT_STRATEGIES, WINDOWS, type SortKey, type Window } from '@/lib/reorder/sort'

export interface VendorOption {
  code: string
  displayName: string
  poolCount: number
}

export interface CollectionOption {
  collection: string
  reorderCount: number
}

/**
 * Vendor first, then collection. Narrowing, never filtering away.
 *
 * Vendor is required and there is deliberately no "all vendors" entry: 8,891
 * sold-out sarees is not a browsable grid, and offering it as a default would
 * teach Pooja that this screen is slow. One weaver at a time is also how the
 * work actually happens — she is on a call with one of them.
 */
export function FilterBar({
  vendors,
  collections,
  vendor,
  collection,
  q,
  sort,
  window,
}: {
  vendors: VendorOption[]
  collections: CollectionOption[]
  vendor: string
  collection: string
  q: string
  sort: SortKey
  window: Window
}) {
  const router = useRouter()

  const go = (
    next: Partial<{ vendor: string; c: string; q: string; sort: string; w: string }>,
  ) => {
    const p = new URLSearchParams()
    const merged = { vendor, c: collection, q, sort, w: String(window), ...next }
    if (merged.vendor) p.set('vendor', merged.vendor)
    if (merged.c) p.set('c', merged.c)
    if (merged.q) p.set('q', merged.q)
    if (merged.sort) p.set('sort', merged.sort)
    if (merged.w) p.set('w', merged.w)
    router.push(`/reorder?${p.toString()}`)
  }

  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-4">
        <Select
          aria-label="Vendor"
          value={vendor}
          // Changing weaver resets the collection: HDR's VINT is not PGW's.
          onChange={(e) => go({ vendor: e.target.value, c: '' })}
        >
          <option value="">Choose a vendor…</option>
          {vendors.map((v) => (
            <option key={v.code} value={v.code}>
              {v.code} — {v.displayName} ({v.poolCount})
            </option>
          ))}
        </Select>

        <Select
          aria-label="Collection"
          value={collection}
          disabled={!vendor}
          onChange={(e) => go({ c: e.target.value })}
        >
          <option value="">All collections</option>
          {collections.map((c) => (
            <option key={c.collection} value={c.collection}>
              {c.collection} ({c.reorderCount})
            </option>
          ))}
        </Select>

        <Select aria-label="Sort" value={sort} onChange={(e) => go({ sort: e.target.value })}>
          {availableSorts().map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </Select>

        {/* Only offered when it changes anything. Beside "Newest first" a sales
            window is a control with no effect, which reads as broken. */}
        <Select
          aria-label="Sales window"
          value={String(window)}
          disabled={!SORT_STRATEGIES[sort].windowed}
          onChange={(e) => go({ w: e.target.value })}
        >
          {WINDOWS.map((days) => (
            <option key={days} value={days}>
              Sold in {days} days
            </option>
          ))}
        </Select>
      </div>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          go({ q: new FormData(e.currentTarget).get('q') as string })
        }}
      >
        <Input name="q" type="search" defaultValue={q} placeholder="Search by code or name" />
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>
    </div>
  )
}
