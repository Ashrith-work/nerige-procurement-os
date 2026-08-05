import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getOrder, getOrderLines, listReceipts } from '@/lib/data/procurement'
import { requireRole } from '@/lib/auth/session'
import {
  Alert,
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  StatusBadge,
  Textarea,
} from '@/components/ui/primitives'
import { recordReceipt, postDraftReceipt } from '../actions'
import { createSkuForDesignLine } from '@/app/(app)/catalogue/actions'
import { formatDate, todayIso, pluralise } from '@/lib/format'
import { describeLine, PO_STATUS_META, type PoStatus, type PoLineKind } from '@/lib/domain/procurement'

interface CountLine {
  id: string
  line_no: number
  kind: PoLineKind
  description: string | null
  colours: string[] | null
  quantity: number
  quantity_received: number
  products: { sku: string; title: string; colour: string | null } | null
  product_series: { name: string } | null
}

export const metadata = { title: 'Count stock in · Nerige Story' }

/**
 * The counting screen.
 *
 * Built as a plain form that works without JavaScript, because it is used on a
 * phone standing next to a parcel, on warehouse wifi. Every field is optional
 * except the counts themselves — asking someone holding a saree in one hand to
 * fill in a form is how a system gets abandoned for a paper notebook.
 *
 * What is deliberately NOT here: prices, order value, payment terms. The
 * warehouse is counting pieces. Money on this screen would be noise at best,
 * and at worst it invites the count to be adjusted to match the bill.
 */
export default async function ReceivePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ error?: string }>
}) {
  await requireRole('founder', 'warehouse_manager', 'procurement_head')
  const { id } = await params
  const { error: errorMessage } = await searchParams
  const po = await getOrder(id)
  if (!po) notFound()
  const vendor = po.vendors as unknown as { display_name: string; code: string } | null

  const [lineRows, drafts, posted] = await Promise.all([
    getOrderLines(id),
    listReceipts({ orderId: id, status: 'draft' }),
    listReceipts({ orderId: id, status: 'posted' }),
  ])

  const lines = lineRows as unknown as CountLine[]
  const outstanding = lines.filter((l) => l.quantity_received < l.quantity)
  const status = po.status as PoStatus

  return (
    <div className="space-y-5">
      <PageHeader
        title={vendor?.display_name ?? 'Count stock in'}
        subtitle={`${po.po_number} · count what actually arrived`}
        action={
          <div className="flex items-center gap-2">
            <StatusBadge status={status} label={PO_STATUS_META[status].label} />
            <Link href="/inbound" className="text-sm text-stone-500 hover:text-stone-900">
              Inbound
            </Link>
          </div>
        }
      />

      {errorMessage && <Alert tone="error">{errorMessage}</Alert>}

      {(po.transporter || po.docket_number || po.parcel_count) && (
        <Alert tone="info">
          Vendor declared:{' '}
          {[
            po.transporter,
            po.docket_number && `docket ${po.docket_number}`,
            po.parcel_count && pluralise(po.parcel_count, 'parcel'),
            po.dispatched_at && `sent ${formatDate(po.dispatched_at)}`,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Alert>
      )}

      {po.instructions && (
        <Card className="bg-stone-50 shadow-none">
          <p className="text-xs font-medium text-stone-500">Order instructions</p>
          <p className="mt-1 whitespace-pre-wrap text-sm">{po.instructions}</p>
        </Card>
      )}

      {(drafts?.length ?? 0) > 0 && (
        <Card className="space-y-2 border-amber-200 bg-amber-50/50">
          <h2 className="text-sm font-semibold">Counts saved but not posted</h2>
          <p className="text-xs text-stone-600">
            Nothing on the order changes until a count is posted.
          </p>
          <ul className="space-y-2">
            {drafts!.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3">
                <span className="text-sm">
                  <span className="font-mono text-xs">{d.grn_number}</span>
                  <span className="ml-2 text-stone-500">{formatDate(d.received_on)}</span>
                </span>
                <form action={postDraftReceipt}>
                  <input type="hidden" name="goods_receipt_id" value={d.id} />
                  <input type="hidden" name="purchase_order_id" value={po.id} />
                  <Button type="submit" variant="secondary">
                    Post it
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {outstanding.length === 0 ? (
        <Card className="space-y-3">
          <h2 className="text-sm font-semibold">Everything on this order is counted in</h2>
          <p className="text-sm text-stone-500">
            All {lines.length} lines are complete. Nothing further is expected.
          </p>
          <Link href="/inbound">
            <Button variant="secondary">Back to inbound</Button>
          </Link>
        </Card>
      ) : (
        <form action={recordReceipt} className="space-y-5">
          <input type="hidden" name="purchase_order_id" value={po.id} />
          <input type="hidden" name="vendor_id" value={po.vendor_id} />

          <div className="overflow-hidden rounded-xl border border-stone-200 bg-white">
            <table className="w-full text-sm">
              <thead className="border-b border-stone-200 bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Item</th>
                  <th className="px-3 py-2 text-right font-medium">Expected</th>
                  <th className="px-3 py-2 text-right font-medium">Good</th>
                  <th className="px-3 py-2 text-right font-medium">Damaged</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {outstanding.map((line) => {
                  const d = describeLine(line)
                  const left = line.quantity - line.quantity_received

                  return (
                    <tr key={line.id} className="align-top">
                      <td className="px-4 py-3">
                        <p className="font-medium">{d.heading}</p>
                        {d.code && <p className="font-mono text-xs text-stone-500">{d.code}</p>}
                        {d.sub && <p className="mt-0.5 text-xs text-stone-500">{d.sub}</p>}
                        {line.kind === 'new_design' && !line.products && (
                          <NewSkuForm lineId={line.id} poId={po.id} vendorCode={vendor?.code ?? ''} />
                        )}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        {left}
                        {line.quantity_received > 0 && (
                          <span className="block text-[11px] text-stone-500">
                            {line.quantity_received} already in
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <Input
                          type="number"
                          inputMode="numeric"
                          name={`received_${line.id}`}
                          min={0}
                          step={1}
                          defaultValue=""
                          placeholder={String(left)}
                          className="w-20 text-right"
                          aria-label={`Good pieces received for ${d.heading}`}
                        />
                      </td>
                      <td className="px-3 py-3 text-right">
                        <Input
                          type="number"
                          inputMode="numeric"
                          name={`damaged_${line.id}`}
                          min={0}
                          step={1}
                          defaultValue=""
                          placeholder="0"
                          className="w-20 text-right"
                          aria-label={`Damaged pieces for ${d.heading}`}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-stone-500">
            Count damaged pieces separately — they arrived, but they are not stock and we do not pay
            for them. Keeping them here is what turns a shortfall into a conversation with evidence.
          </p>

          <Card className="grid gap-4 sm:grid-cols-3">
            <Field label="Received on">
              <Input type="date" name="received_on" defaultValue={todayIso()} />
            </Field>
            <Field label="Parcels opened">
              <Input
                type="number"
                name="parcel_count"
                min={1}
                step={1}
                defaultValue={po.parcel_count ?? ''}
              />
            </Field>
            <Field label="Docket number">
              <Input name="docket_number" defaultValue={po.docket_number ?? ''} />
            </Field>
            <div className="sm:col-span-3">
              <Field label="Anything worth noting">
                <Textarea
                  name="notes"
                  rows={2}
                  placeholder="One parcel arrived open. Two pieces stained along the border."
                />
              </Field>
            </div>
          </Card>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" name="post" value="1">
              Post count
            </Button>
            <Button type="submit" name="post" value="0" variant="secondary">
              Save and finish later
            </Button>
          </div>

          <p className="text-xs text-stone-500">
            Posting updates the order and cannot be undone. If a number turns out to be wrong,
            post a second count rather than editing this one.
          </p>
        </form>
      )}

      {(posted?.length ?? 0) > 0 && (
        <Card className="space-y-2">
          <h2 className="text-sm font-semibold">Already counted</h2>
          <ul className="divide-y divide-stone-100 text-sm">
            {posted!.map((r) => {
              const grnLines = (r.goods_receipt_lines ?? []) as {
                quantity_received: number
                quantity_damaged: number
              }[]
              const good = grnLines.reduce((n, l) => n + l.quantity_received, 0)
              const damaged = grnLines.reduce((n, l) => n + l.quantity_damaged, 0)

              return (
                <li key={r.id} className="flex items-center justify-between gap-2 py-2">
                  <span>
                    <span className="font-mono text-xs">{r.grn_number}</span>
                    <span className="ml-2 text-stone-500">{formatDate(r.received_on)}</span>
                  </span>
                  <span className="tabular-nums text-stone-600">
                    {good} good{damaged > 0 && `, ${damaged} damaged`}
                  </span>
                </li>
              )
            })}
          </ul>
        </Card>
      )}
    </div>
  )
}

/**
 * Naming a commissioned design, at the only moment it can honestly be named.
 *
 * The order carried a brief and no code, because the saree did not exist. It is
 * on the table now. Whoever is counting can see the colour and the border, so
 * this is where the SKU gets created — and from here on the piece, the label
 * and the catalogue all say the same thing.
 */
function NewSkuForm({
  lineId,
  poId,
  vendorCode,
}: {
  lineId: string
  poId: string
  vendorCode: string
}) {
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-xs font-medium text-sky-700">
        No code yet — create one
      </summary>
      <form action={createSkuForDesignLine} className="mt-2 space-y-2">
        <input type="hidden" name="line_id" value={lineId} />
        <input type="hidden" name="return_to" value={`/inbound/${poId}`} />
        <Input
          name="sku"
          required
          placeholder={`${vendorCode.toLowerCase()}xx00001`}
          className="font-mono text-sm"
          aria-label="New SKU code"
        />
        <Input name="title" required placeholder="What is it called?" className="text-sm" aria-label="Name" />
        <Input name="colour" placeholder="Colour" className="text-sm" aria-label="Colour" />
        <Button type="submit" variant="secondary">
          Create code
        </Button>
      </form>
    </details>
  )
}
