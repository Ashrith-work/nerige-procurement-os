import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth/session'
import { Button, EmptyState, PageHeader } from '@/components/ui/primitives'
import { BillForm, type BillableOrder } from '@/components/bills/bill-form'
import { receivedValue } from '@/lib/domain/procurement'

export const metadata = { title: 'Add a bill · Nerige Story' }

interface BillableRow {
  id: string
  po_number: string
  status: string
  vendors: { display_name: string } | null
  purchase_order_lines: { quantity_received: number; unit_price: string; gst_rate: string }[]
}

export default async function NewBillPage({
  searchParams,
}: {
  searchParams: Promise<{ po?: string }>
}) {
  await requireRole('founder', 'procurement_head')
  const { po } = await searchParams
  const supabase = await createClient()

  // Only orders with stock actually counted in. A bill for goods that have not
  // arrived is the thing the three-way match exists to catch, and offering the
  // order here would quietly invite it.
  const { data } = await supabase
    .from('purchase_orders')
    .select(
      `id, po_number, status, vendors(display_name),
       purchase_order_lines(quantity_received, unit_price, gst_rate)`,
    )
    .in('status', ['partially_received', 'received', 'dispatched'])
    .is('deleted_at', null)
    .order('received_at', { ascending: false, nullsFirst: false })
    .limit(100)

  const rows = (data ?? []) as unknown as BillableRow[]
  const orders: BillableOrder[] = rows
    .filter((r) => r.purchase_order_lines.some((l) => l.quantity_received > 0))
    .map((r) => ({
      id: r.id,
      po_number: r.po_number,
      label: r.vendors?.display_name ?? 'Vendor',
      receivedValue: receivedValue(r.purchase_order_lines),
    }))

  if (orders.length === 0) {
    return (
      <div className="mx-auto max-w-2xl space-y-5">
        <PageHeader title="Add a bill" />
        <EmptyState
          title="Nothing has been counted in yet"
          body="A bill is attached to an order that stock has actually arrived against. Count a consignment in first, then the order becomes billable."
          action={
            <Link href="/inbound">
              <Button>Go to inbound</Button>
            </Link>
          }
        />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader
        title="Add a bill"
        subtitle="Attach the hard copy to the order it belongs to."
        action={
          <Link href="/bills" className="text-sm text-stone-500 hover:text-stone-900">
            All bills
          </Link>
        }
      />
      <BillForm orders={orders} defaultOrderId={po} audience="staff" />
    </div>
  )
}
