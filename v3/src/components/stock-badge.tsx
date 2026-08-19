/**
 * How many pieces are left, across the top of a photograph.
 *
 * Four states, because a single "N units" string gets three of them wrong:
 *
 *   n > 1   "12 available"   — ordinary stock
 *   n === 1 "Last piece"     — the reorder pool's other half, and the one a
 *                              number renders least legibly: "1 available"
 *                              reads as availability, when it means almost none
 *   n === 0 "Sold out"       — not "0 available", which invites the reader to
 *                              parse a zero before understanding it
 *   n < 0   "Oversold by 117" — Shopify goes negative when a design sells past
 *                              its inventory. "-117 available" is nonsense on
 *                              its face; the fact is that 117 pieces are owed.
 *
 * The last is the one worth surfacing rather than clamping. An oversold design
 * is sold out AND in demand, and it currently falls outside the reorder pool
 * because a negative quantity is not in (0, 1) — see migration 027. Until that
 * predicate is decided, this badge is the only place the condition is visible
 * at all.
 *
 * Sits ON the image rather than under it, on the same argument as the "edited"
 * marker opposite: the card's own text column belongs to the SKU, which is
 * copied onto a fabric label by hand and must not compete for width.
 */
export function StockBadge({ qty }: { qty: number | null }) {
  // Distinct from zero on purpose. Null is "Shopify does not track inventory
  // for this design", not "there are none" — and putting "Sold out" on a design
  // that is simply untracked would send someone to reorder it.
  if (qty === null) return null

  const { label, tone } =
    qty < 0
      ? { label: `Oversold by ${Math.abs(qty)}`, tone: 'bg-amber-600/90' }
      : qty === 0
        ? { label: 'Sold out', tone: 'bg-stone-900/80' }
        : qty === 1
          ? { label: 'Last piece', tone: 'bg-stone-900/80' }
          : { label: `${qty.toLocaleString('en-IN')} available`, tone: 'bg-stone-900/70' }

  return (
    <span
      className={`absolute top-1 left-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-white tabular-nums ${tone}`}
    >
      {label}
    </span>
  )
}
