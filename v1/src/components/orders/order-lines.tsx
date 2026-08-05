import { Card } from '@/components/ui/primitives'
import { money, moneyExact } from '@/lib/format'
import { describeLine, type PoLineKind } from '@/lib/domain/procurement'

export interface OrderLine {
  id: string
  line_no: number
  kind: PoLineKind
  description: string | null
  colours: string[] | null
  quantity: number
  unit_price: string
  gst_rate: string
  quantity_received: number
  line_total: string
  products: { sku: string; title: string; colour: string | null } | null
  product_series: { name: string } | null
}

/**
 * The order, line by line, for whoever is looking at it.
 *
 * Shared between the procurement screen and the vendor portal on purpose: the
 * two sides arguing from differently-formatted copies of the same order is the
 * problem this system was built to end. The only difference is the action
 * column, which the caller supplies.
 */
export function OrderLines({
  lines,
  showReceived,
  action,
}: {
  lines: OrderLine[]
  /** Received counts are noise until something has actually been counted in. */
  showReceived: boolean
  action?: (line: OrderLine) => React.ReactNode
}) {
  if (lines.length === 0) {
    return (
      <Card className="border-dashed bg-transparent shadow-none">
        <p className="text-sm text-stone-500">
          Nothing on this order yet. Add a restock or commission a new design.
        </p>
      </Card>
    )
  }

  const totalPieces = lines.reduce((n, l) => n + l.quantity, 0)
  const totalReceived = lines.reduce((n, l) => n + l.quantity_received, 0)

  return (
    <div className="overflow-hidden rounded-xl border border-stone-200 bg-white">
      <table className="w-full text-sm">
        <thead className="border-b border-stone-200 bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
          <tr>
            <th className="px-4 py-2 font-medium">Item</th>
            <th className="px-4 py-2 text-right font-medium">Pieces</th>
            {showReceived && <th className="px-4 py-2 text-right font-medium">Received</th>}
            <th className="px-4 py-2 text-right font-medium">Rate</th>
            <th className="px-4 py-2 text-right font-medium">Value</th>
            {action && <th className="px-4 py-2" />}
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {lines.map((line) => {
            const d = describeLine(line)
            const short = line.quantity_received < line.quantity

            return (
              <tr key={line.id} className="align-top">
                <td className="px-4 py-3">
                  <p className="font-medium">{d.heading}</p>
                  {d.sub && <p className="mt-0.5 text-xs text-stone-500">{d.sub}</p>}
                  {d.code && (
                    <p className="mt-0.5 font-mono text-xs text-stone-500">{d.code}</p>
                  )}
                  {line.kind === 'new_design' && (
                    <span className="mt-1 inline-flex rounded bg-sky-50 px-1.5 py-0.5 text-[11px] font-medium text-sky-700">
                      New design — no SKU yet
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{line.quantity}</td>
                {showReceived && (
                  <td className="px-4 py-3 text-right tabular-nums">
                    <span className={short ? 'font-medium text-amber-700' : 'text-emerald-700'}>
                      {line.quantity_received}
                    </span>
                    {short && (
                      <span className="block text-[11px] text-stone-500">
                        {line.quantity - line.quantity_received} short
                      </span>
                    )}
                  </td>
                )}
                <td className="px-4 py-3 text-right tabular-nums text-stone-600">
                  {moneyExact(line.unit_price)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{money(line.line_total)}</td>
                {action && <td className="px-4 py-3 text-right">{action(line)}</td>}
              </tr>
            )
          })}
        </tbody>
        <tfoot className="border-t border-stone-200 bg-stone-50 text-sm">
          <tr>
            <td className="px-4 py-2 font-medium">Total</td>
            <td className="px-4 py-2 text-right font-medium tabular-nums">{totalPieces}</td>
            {showReceived && (
              <td className="px-4 py-2 text-right font-medium tabular-nums">{totalReceived}</td>
            )}
            <td />
            <td className="px-4 py-2 text-right font-medium tabular-nums">
              {money(lines.reduce((sum, l) => sum + Number(l.line_total), 0))}
            </td>
            {action && <td />}
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
