import { formatDistanceToNow } from 'date-fns'
import type { Dictionary } from '@/lib/i18n'

/**
 * A quantity, and how old it is.
 *
 * The age is not decoration. `qty_available` comes from EasyEcom and is only
 * ever as fresh as the last sync, so a number presented as live when it is
 * three days old will send a weaver to weave something we still have twelve of.
 * Every quantity in this build renders through here, which is the only way that
 * rule survives contact with the next screen someone adds.
 */
export function StockLine({
  qty,
  syncedAt,
  t,
}: {
  qty: number
  syncedAt: string | null
  t: Dictionary
}) {
  const quantity =
    qty <= 0
      ? t.catalogue.soldOut
      : (qty === 1 ? t.catalogue.inStock_one : t.catalogue.inStock_other).replace(
          '{n}',
          String(qty),
        )

  const age = syncedAt
    ? t.catalogue.checkedAgo.replace('{ago}', formatDistanceToNow(new Date(syncedAt)) + ' ago')
    : t.catalogue.neverChecked

  return (
    <p className="text-[15px] text-stone-900">
      <span className="font-medium tabular-nums">{quantity}</span>
      <span className="text-stone-400"> · </span>
      <span className="text-sm text-stone-500">{age}</span>
    </p>
  )
}
