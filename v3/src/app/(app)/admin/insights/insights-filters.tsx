'use client'

import { useRouter } from 'next/navigation'
import { useMemo } from 'react'
import { PRESETS, type Filters, type Preset } from '@/lib/insights/model'
import { Button, Input, Card } from '@/components/ui/primitives'
import { cn } from '@/lib/utils'

export interface FacetRow {
  vendor_code: string
  collection: string | null
  fabric: string | null
  colour_code: string | null
  design_count: number
}

/**
 * Four stacked filters, each narrowing the next.
 *
 * The narrowing is real, not cosmetic: choosing HDR means the collection list
 * shows only collections HDR actually has, and choosing VINT means the fabric
 * list shows only fabrics that exist inside HDR/VINT. A dropdown offering a
 * combination with nothing behind it produces an empty dashboard and no
 * explanation for it, which reads as broken rather than as empty.
 *
 * Multi-select is done as toggleable chips rather than a `<select multiple>`.
 * Native multi-selects require ctrl-click to add and lose the whole selection
 * on a stray click — on a screen where each change reloads a dashboard, that is
 * a lost minute every time it happens.
 *
 * Everything lands in the URL, so a view is a link somebody can be sent.
 */
export function InsightsFilters({
  facets,
  filters,
  preset,
}: {
  facets: FacetRow[]
  filters: Filters
  preset: Preset | null
}) {
  const router = useRouter()

  // Each level's options come from the rows surviving the levels above it.
  const options = useMemo(() => {
    const byVendor = facets
    const afterVendor = filters.vendors.length
      ? byVendor.filter((f) => filters.vendors.includes(f.vendor_code))
      : byVendor
    const afterCollection = filters.collections.length
      ? afterVendor.filter((f) => f.collection && filters.collections.includes(f.collection))
      : afterVendor
    const afterFabric = filters.fabrics.length
      ? afterCollection.filter((f) => f.fabric && filters.fabrics.includes(f.fabric))
      : afterCollection

    const tally = (rows: FacetRow[], key: keyof FacetRow) => {
      const counts = new Map<string, number>()
      for (const row of rows) {
        const value = row[key]
        if (typeof value !== 'string' || value === '') continue
        counts.set(value, (counts.get(value) ?? 0) + row.design_count)
      }
      return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    }

    return {
      vendors: tally(byVendor, 'vendor_code'),
      collections: tally(afterVendor, 'collection'),
      fabrics: tally(afterCollection, 'fabric'),
      colours: tally(afterFabric, 'colour_code'),
    }
  }, [facets, filters])

  const push = (next: Partial<Filters> & { days?: Preset | null }) => {
    const merged = { ...filters, ...next }
    const p = new URLSearchParams()

    if ('days' in next && next.days) {
      p.set('days', String(next.days))
    } else {
      p.set('from', merged.from)
      p.set('to', merged.to)
    }

    for (const code of merged.vendors) p.append('vendor', code)
    for (const c of merged.collections) p.append('collection', c)
    for (const f of merged.fabrics) p.append('fabric', f)
    for (const c of merged.colours) p.append('colour', c)

    router.push(`/admin/insights?${p.toString()}`)
  }

  /**
   * Toggling a level clears everything below it. Keeping HDR's collection
   * selected after switching to PGW would filter to a combination that does not
   * exist, and the dashboard would go blank for no visible reason.
   */
  const toggle = (level: keyof Filters, value: string) => {
    const current = filters[level] as string[]
    const next = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value]

    const cleared: Partial<Filters> = { [level]: next }
    if (level === 'vendors') Object.assign(cleared, { collections: [], fabrics: [], colours: [] })
    if (level === 'collections') Object.assign(cleared, { fabrics: [], colours: [] })
    if (level === 'fabrics') Object.assign(cleared, { colours: [] })

    push(cleared)
  }

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-wrap gap-1">
          {PRESETS.map((days) => (
            <button
              key={days}
              type="button"
              onClick={() => push({ days })}
              className={cn(
                'min-h-11 rounded-lg border px-3 text-sm',
                preset === days
                  ? 'border-stone-900 bg-stone-900 text-white'
                  : 'border-stone-300 bg-white text-stone-700 hover:bg-stone-50',
              )}
            >
              {days} days
            </button>
          ))}
        </div>

        <form
          action="/admin/insights"
          className="flex flex-wrap items-end gap-2"
          // Preserve the facet selection when the dates change by hand.
        >
          {filters.vendors.map((v) => (
            <input key={v} type="hidden" name="vendor" value={v} />
          ))}
          {filters.collections.map((v) => (
            <input key={v} type="hidden" name="collection" value={v} />
          ))}
          {filters.fabrics.map((v) => (
            <input key={v} type="hidden" name="fabric" value={v} />
          ))}
          {filters.colours.map((v) => (
            <input key={v} type="hidden" name="colour" value={v} />
          ))}

          <label className="text-sm text-stone-600">
            From
            <Input type="date" name="from" defaultValue={filters.from} className="mt-1" />
          </label>
          <label className="text-sm text-stone-600">
            To
            <Input type="date" name="to" defaultValue={filters.to} className="mt-1" />
          </label>
          <Button type="submit" variant="secondary">
            Apply
          </Button>
        </form>
      </div>

      <ChipRow
        label="Vendor"
        options={options.vendors}
        selected={filters.vendors}
        onToggle={(v) => toggle('vendors', v)}
      />
      <ChipRow
        label="Collection"
        options={options.collections}
        selected={filters.collections}
        onToggle={(v) => toggle('collections', v)}
      />
      <ChipRow
        label="Fabric"
        options={options.fabrics}
        selected={filters.fabrics}
        onToggle={(v) => toggle('fabrics', v)}
      />
      <ChipRow
        label="Colour"
        options={options.colours}
        selected={filters.colours}
        onToggle={(v) => toggle('colours', v)}
      />
    </Card>
  )
}

/**
 * Capped at 40 chips, most-designs first.
 *
 * HDR alone has 81 colours; four uncapped rows would be several hundred chips
 * and the date controls would be off the top of the screen. The cap is stated
 * rather than silent — a row that has quietly hidden 41 options while looking
 * complete is worse than one that says so.
 */
const MAX_CHIPS = 40

function ChipRow({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string
  options: [string, number][]
  selected: string[]
  onToggle: (value: string) => void
}) {
  if (options.length === 0) return null

  // Anything already chosen is always shown, even past the cap — otherwise
  // deselecting it would be impossible.
  const shown = [
    ...options.filter(([v]) => selected.includes(v)),
    ...options.filter(([v]) => !selected.includes(v)).slice(0, MAX_CHIPS),
  ]
  const hidden = options.length - shown.length

  return (
    <div className="space-y-1">
      <p className="text-xs font-medium tracking-wide text-stone-500 uppercase">{label}</p>
      <div className="flex flex-wrap gap-1">
        {shown.map(([value, count]) => {
          const on = selected.includes(value)
          return (
            <button
              key={value}
              type="button"
              onClick={() => onToggle(value)}
              aria-pressed={on}
              className={cn(
                'rounded-full border px-2.5 py-1 text-xs',
                on
                  ? 'border-stone-900 bg-stone-900 text-white'
                  : 'border-stone-300 bg-white text-stone-700 hover:bg-stone-50',
              )}
            >
              {value}{' '}
              <span className={on ? 'text-stone-300' : 'text-stone-400'}>
                {count.toLocaleString('en-IN')}
              </span>
            </button>
          )
        })}
        {hidden > 0 && (
          <span className="self-center text-xs text-stone-400">
            +{hidden} more — narrow the level above to see them
          </span>
        )}
      </div>
    </div>
  )
}
