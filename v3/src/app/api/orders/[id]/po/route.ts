import { type NextRequest } from 'next/server'
import { requireProcurement } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { buildPurchaseOrder, type PoLine } from '@/lib/po/pdf'

/**
 * The PO as a download.
 *
 * Built on demand from the order rather than served from a stored file, so it
 * always reflects the order as it stands — and so there is nothing to keep in
 * step. The PO NUMBER is stored, because that is an identifier; the document is
 * just a rendering of it.
 */
export const dynamic = 'force-dynamic'

interface RawLine {
  line_type: string
  sku: string | null
  brief: string | null
  quantity: number
  snapshot_title: string | null
  snapshot_image_url: string | null
  order_line_refs: { snapshot_image_url: string | null }[] | null
}

export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  await requireProcurement()

  const { id } = await ctx.params
  const supabase = await createClient()

  const { data: order } = await supabase
    .from('orders')
    .select(
      `id, order_number, issued_at, po_number,
       vendors ( display_name, code, primary_phone, whatsapp_number ),
       order_lines (
         line_type, sku, brief, quantity, snapshot_title, snapshot_image_url,
         order_line_refs ( snapshot_image_url )
       )`,
    )
    .eq('id', id)
    .maybeSingle()

  if (!order) return new Response('Not found', { status: 404 })

  if (!order.po_number) {
    return new Response('This order has no PO number yet. Generate the PO first.', { status: 409 })
  }

  type V = {
    display_name: string
    code: string
    primary_phone: string | null
    whatsapp_number: string | null
  }
  const embedded = order.vendors as V | V[] | null
  const vendor = Array.isArray(embedded) ? embedded[0] : embedded

  const restock: PoLine[] = []
  const newDesigns: PoLine[] = []

  for (const line of (order.order_lines ?? []) as RawLine[]) {
    const entry: PoLine = {
      sku: line.line_type === 'restock' ? line.sku : null,
      name: line.line_type === 'restock' ? line.snapshot_title : line.brief,
      quantity: line.quantity,
      imageUrl: line.snapshot_image_url ?? line.order_line_refs?.[0]?.snapshot_image_url ?? null,
      isNewDesign: line.line_type !== 'restock',
    }
    if (entry.isNewDesign) newDesigns.push(entry)
    else restock.push(entry)
  }

  const pdf = await buildPurchaseOrder({
    poNumber: order.po_number,
    orderNumber: order.order_number,
    issuedAt: new Date(order.issued_at),
    vendorName: vendor?.display_name ?? 'Unknown vendor',
    vendorCode: vendor?.code ?? '',
    vendorPhone: vendor?.whatsapp_number ?? vendor?.primary_phone ?? null,
    restock,
    newDesigns,
  })

  return new Response(pdf as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${order.po_number}.pdf"`,
      'Cache-Control': 'no-store',
    },
  })
}
