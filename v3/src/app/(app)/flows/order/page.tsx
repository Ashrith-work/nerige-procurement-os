import Link from 'next/link'
import { requireProcurement } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { EmptyState, PageHeader } from '@/components/ui/primitives'
import { FlowStepper } from '@/components/flow/stepper'
import { withFlow } from '@/components/flow/flows'

export const metadata = { title: 'Order sarees · Nerige' }

/** An order that has left here and not come back: the weaver still owes pieces. */
const OPEN_STATUSES = ['issued', 'accepted', 'dispatched']

interface Weaver {
  id: string
  code: string
  displayName: string
  status: string
  /** How many of her designs are sold out or down to their last piece. */
  pool: number
  openOrders: number
}

/**
 * Step 1 of ordering: whose sarees.
 *
 * The reorder grid has always started here — it renders nothing until a vendor
 * is chosen, because nearly nine thousand designs is not a grid anybody browses.
 * That decision was buried in a filter bar at the top of an empty screen; here
 * it is the screen, and it carries the two numbers that actually decide it: how
 * much of hers is waiting to be made again, and how much she is already holding.
 *
 * A weaver with eleven open orders and six designs in the pool is usually the
 * wrong answer, and that was invisible from the filter bar.
 *
 * Choosing hands off to `/reorder` itself, with the flow named on the URL so the
 * grid shows the progress bar above it. Nothing about the grid changes.
 */
export default async function OrderFlowPage({
  searchParams,
}: {
  searchParams: Promise<{ all?: string }>
}) {
  await requireProcurement()
  const { all } = await searchParams
  const showAll = all === '1'
  const supabase = await createClient()

  const [{ data: vendorRows, error }, { data: collectionRows }, { data: orderRows }] =
    await Promise.all([
      supabase
        .from('vendors')
        .select('id, code, display_name, status, is_placeholder')
        .is('deleted_at', null),
      supabase.from('vendor_collections').select('vendor_id, reorder_count'),
      supabase.from('orders').select('vendor_id, status').in('status', OPEN_STATUSES),
    ])

  const pool = new Map<string, number>()
  for (const row of collectionRows ?? []) {
    pool.set(row.vendor_id, (pool.get(row.vendor_id) ?? 0) + row.reorder_count)
  }

  const open = new Map<string, number>()
  for (const row of orderRows ?? []) {
    open.set(row.vendor_id, (open.get(row.vendor_id) ?? 0) + 1)
  }

  const weavers: Weaver[] = (vendorRows ?? [])
    // The holding pen for designs whose SKU names no weaver is not a supplier
    // and must never be offered as one (migration 20260819000100). Archived
    // houses are ones we have stopped working with.
    .filter((v) => !v.is_placeholder && v.status !== 'archived')
    .map((v) => ({
      id: v.id as string,
      code: v.code as string,
      displayName: v.display_name as string,
      status: v.status as string,
      pool: pool.get(v.id as string) ?? 0,
      openOrders: open.get(v.id as string) ?? 0,
    }))
    .sort((a, b) => b.pool - a.pool || a.displayName.localeCompare(b.displayName))

  const waiting = weavers.filter((w) => w.pool > 0)
  const shown = showAll ? weavers : waiting
  const hidden = weavers.length - waiting.length

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <FlowStepper flow="order" current={1} hrefs={{ weaver: '/flows/order' }} />

      <PageHeader
        title="Order sarees"
        subtitle="The biggest backlog first. Tap a weaver to see what of hers can be made again."
      />

      {error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          Could not load the weavers: {error.message}. Nothing below is a complete list.
        </p>
      )}

      {shown.length === 0 ? (
        <EmptyState
          title="Nothing is waiting to be reordered"
          body="No weaver has a design that is sold out or down to its last piece. That changes as stock syncs."
          action={
            <Link
              href="/reorder"
              className="inline-flex min-h-11 items-center rounded-lg border border-stone-300 bg-white px-4 text-sm font-medium text-stone-900 hover:bg-stone-50"
            >
              Open the reorder grid anyway
            </Link>
          }
        />
      ) : (
        <ul className="divide-y divide-stone-200 rounded-xl border border-stone-200">
          {shown.map((w) => (
            <li key={w.id}>
              <Link
                href={withFlow(`/reorder?vendor=${encodeURIComponent(w.code)}`, 'order')}
                className="flex min-h-14 flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 hover:bg-stone-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-stone-900 focus-visible:outline-none"
              >
                <span className="min-w-0">
                  <span className="block font-medium text-stone-900">
                    {w.displayName}{' '}
                    <span className="font-mono text-sm font-normal text-stone-500">{w.code}</span>
                  </span>
                  <span className="block text-sm text-stone-600 tabular-nums">
                    {w.pool > 0 ? `${w.pool.toLocaleString('en-IN')} to reorder` : 'Nothing to reorder'}
                    <span className="text-stone-400"> · </span>
                    {w.openOrders === 0
                      ? 'no open orders'
                      : `${w.openOrders} open order${w.openOrders === 1 ? '' : 's'}`}
                  </span>
                </span>
                {w.status === 'on_hold' && (
                  <span className="rounded-full bg-orange-50 px-2 py-0.5 text-xs font-medium text-orange-700 ring-1 ring-orange-600/20 ring-inset">
                    On hold
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {/* Every weaver, including the ones with nothing waiting — Pooja sometimes
          orders from a house whose pool is empty because she has just been on
          the phone to it. */}
      {hidden > 0 && (
        <p className="text-sm text-stone-500">
          {showAll ? (
            <Link href="/flows/order" className="min-h-11 underline underline-offset-2">
              Show only weavers with something waiting
            </Link>
          ) : (
            <Link href="/flows/order?all=1" className="min-h-11 underline underline-offset-2">
              Show every weaver ({hidden} with nothing waiting)
            </Link>
          )}
        </p>
      )}
    </div>
  )
}
