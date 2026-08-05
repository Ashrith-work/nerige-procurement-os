import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { isDemoMode } from '@/lib/demo'
import {
  demoOrders,
  demoOrder,
  demoOrderLines,
  demoMessages,
  demoReceipts,
  demoBills,
  demoBill,
  demoProducts,
  demoSeries,
} from '@/lib/demo/procurement'
import { OPEN_PO_STATUSES, RECEIVABLE_PO_STATUSES } from '@/lib/domain/procurement'

/**
 * Procurement reads, in one place.
 *
 * Mirrors `./vendors.ts`: pages do not carry an `if (demo)` branch each, and
 * when the Shopify sync lands in M8 the shape of "a product for a list screen"
 * changes in one file rather than in five.
 *
 * ON THE `vendorId` ARGUMENT — this matters and is easy to misread.
 *
 * It is used ONLY by the demo branch, to reproduce what Row Level Security does
 * for real. The Supabase queries below deliberately carry no vendor filter,
 * because the database already scopes them: a vendor's session cannot see
 * another vendor's rows, and cannot see a draft order at all. Adding a
 * `.eq('vendor_id', …)` here would imply the application is what protects the
 * data — and the moment anyone believes that, someone reaches for the
 * service-role key to "fix" an empty result.
 *
 * ON ERRORS — every read throws rather than returning an empty array. An
 * unreachable database is not "no orders", and a dashboard that renders
 * "Nothing needs chasing" because the connection failed is worse than one that
 * shows an error: the first is believed.
 */

/** Throws on a failed read so a connection problem cannot read as empty data. */
function unwrap<T>(result: { data: T | null; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`Could not load ${what}: ${result.error.message}`)
  return (result.data ?? []) as T
}

// -----------------------------------------------------------------------------
// Orders
// -----------------------------------------------------------------------------

const ORDER_LIST_COLUMNS = `id, po_number, status, title, required_by, promised_date, issued_at,
   dispatched_at, transporter, docket_number, parcel_count, total_amount,
   vendors(display_name, code),
   purchase_order_lines(quantity, quantity_received)`

export type OrderScope = 'open' | 'draft' | 'waiting' | 'late' | 'inbound' | 'all'

export async function listOrders(
  scope: OrderScope,
  opts: { vendorId?: string | null; vendorFilter?: string } = {},
) {
  if (isDemoMode()) {
    const today = new Date().toISOString().slice(0, 10)
    let rows = demoOrders(opts.vendorId ?? null)

    if (opts.vendorFilter) rows = rows.filter((o) => o.vendor_id === opts.vendorFilter)

    switch (scope) {
      case 'draft':
        rows = rows.filter((o) => o.status === 'draft')
        break
      case 'waiting':
        rows = rows.filter((o) => ['issued', 'acknowledged', 'in_production'].includes(o.status))
        break
      case 'late':
        rows = rows.filter(
          (o) =>
            OPEN_PO_STATUSES.includes(o.status as never) &&
            o.required_by !== null &&
            o.required_by < today,
        )
        break
      case 'inbound':
        rows = rows.filter((o) => RECEIVABLE_PO_STATUSES.includes(o.status as never))
        break
      case 'all':
        break
      default:
        rows = rows.filter((o) => OPEN_PO_STATUSES.includes(o.status as never))
    }

    return rows.sort((a, b) => (a.required_by ?? '9999').localeCompare(b.required_by ?? '9999'))
  }

  const supabase = await createClient()
  let query = supabase
    .from('purchase_orders')
    .select(ORDER_LIST_COLUMNS)
    .is('deleted_at', null)
    .order('required_by', { ascending: true, nullsFirst: false })
    .limit(200)

  if (opts.vendorFilter) query = query.eq('vendor_id', opts.vendorFilter)

  switch (scope) {
    case 'draft':
      query = query.eq('status', 'draft')
      break
    case 'waiting':
      query = query.in('status', ['issued', 'acknowledged', 'in_production'])
      break
    case 'late':
      query = query.in('status', OPEN_PO_STATUSES).lt('required_by', new Date().toISOString().slice(0, 10))
      break
    case 'inbound':
      query = query.in('status', RECEIVABLE_PO_STATUSES)
      break
    case 'all':
      break
    default:
      query = query.in('status', OPEN_PO_STATUSES)
  }

  return unwrap(await query, 'purchase orders') as unknown as Awaited<ReturnType<typeof demoOrders>>
}

export async function getOrder(id: string, vendorId: string | null = null) {
  if (isDemoMode()) return demoOrder(id, vendorId)

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('purchase_orders')
    .select(
      `id, vendor_id, po_number, status, title, required_by, promised_date, instructions,
       issued_at, acknowledged_at, dispatched_at, transporter, docket_number, parcel_count,
       received_at, closed_at, cancellation_reason,
       subtotal_amount, tax_amount, total_amount,
       vendors(display_name, code, primary_phone)`,
    )
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()

  if (error) throw new Error(`Could not load the order: ${error.message}`)
  return data as unknown as Awaited<ReturnType<typeof demoOrder>>
}

export async function getOrderLines(orderId: string) {
  if (isDemoMode()) return demoOrderLines(orderId)

  const supabase = await createClient()
  const result = await supabase
    .from('purchase_order_lines')
    .select(
      `id, line_no, kind, description, colours, quantity, unit_price, gst_rate,
       quantity_received, line_total, product_id,
       products(sku, title, colour), product_series(name)`,
    )
    .eq('purchase_order_id', orderId)
    .is('deleted_at', null)
    .order('line_no')

  return unwrap(result, 'the order lines') as unknown as ReturnType<typeof demoOrderLines>
}

export async function getOrderMessages(orderId: string, includeInternal: boolean) {
  if (isDemoMode()) return demoMessages(orderId, includeInternal)

  const supabase = await createClient()
  // No is_internal filter: the RLS policy already hides internal notes from a
  // vendor session, and filtering here as well would hide a policy failure.
  const result = await supabase
    .from('purchase_order_messages')
    .select('id, body, is_internal, created_at, author_id, app_users(full_name, role)')
    .eq('purchase_order_id', orderId)
    .order('created_at')

  return unwrap(result, 'the conversation') as unknown as ReturnType<typeof demoMessages>
}

// -----------------------------------------------------------------------------
// Receipts
// -----------------------------------------------------------------------------

export async function listReceipts(
  filter: { orderId?: string; status?: 'draft' | 'posted'; vendorId?: string | null } = {},
) {
  if (isDemoMode()) {
    const rows = demoReceipts({ orderId: filter.orderId, vendorId: filter.vendorId })
    return filter.status ? rows.filter((r) => r.status === filter.status) : rows
  }

  const supabase = await createClient()
  let query = supabase
    .from('goods_receipts')
    .select(
      `id, grn_number, status, received_on, purchase_order_id, parcel_count, docket_number, notes,
       purchase_orders(po_number, vendors(display_name)),
       goods_receipt_lines(quantity_received, quantity_damaged)`,
    )
    .is('deleted_at', null)
    .order('received_on', { ascending: false })
    .limit(50)

  if (filter.orderId) query = query.eq('purchase_order_id', filter.orderId)
  if (filter.status) query = query.eq('status', filter.status)

  return unwrap(await query, 'goods receipts') as unknown as ReturnType<typeof demoReceipts>
}

// -----------------------------------------------------------------------------
// Bills
// -----------------------------------------------------------------------------

export async function listBills(vendorId: string | null = null) {
  if (isDemoMode()) return demoBills(vendorId)

  const supabase = await createClient()
  const result = await supabase
    .from('vendor_bills')
    .select(
      `id, bill_number, bill_date, due_date, status, subtotal_amount, tax_amount, total_amount,
       matched_received_value, variance_amount, variance_note, payment_reference,
       reviewed_at, approved_at, paid_at, document_id, purchase_order_id, vendor_id,
       vendors(display_name, code, msme_category),
       purchase_orders(po_number, total_amount)`,
    )
    .is('deleted_at', null)
    .order('due_date', { ascending: true, nullsFirst: false })
    .limit(200)

  return unwrap(result, 'bills') as unknown as ReturnType<typeof demoBills>
}

export async function getBill(id: string) {
  if (isDemoMode()) return demoBill(id)

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('vendor_bills')
    .select(
      `id, bill_number, bill_date, due_date, status, subtotal_amount, tax_amount, total_amount,
       matched_received_value, variance_amount, variance_note, payment_reference,
       reviewed_at, approved_at, paid_at, document_id, purchase_order_id, vendor_id,
       vendors(display_name, code, msme_category, payment_terms_days),
       purchase_orders(po_number, total_amount)`,
    )
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()

  if (error) throw new Error(`Could not load the bill: ${error.message}`)
  return data as unknown as ReturnType<typeof demoBill>
}

// -----------------------------------------------------------------------------
// Catalogue
// -----------------------------------------------------------------------------

export async function listProducts(
  filters: { vendorId?: string | null; vendorFilter?: string; q?: string } = {},
) {
  if (isDemoMode()) {
    return demoProducts({
      vendorId: filters.vendorFilter ?? filters.vendorId ?? null,
      q: filters.q,
    })
  }

  const supabase = await createClient()
  let query = supabase
    .from('products')
    .select(
      `id, vendor_id, series_id, sku, title, colour, fabric, variant_note, status,
       cost_price, mrp, gst_rate, last_ordered_at, units_ordered_total,
       units_sold_30d, units_sold_90d, sales_synced_at,
       vendors(display_name, code), product_series(name)`,
    )
    .is('deleted_at', null)
    .order('sku')
    .limit(500)

  if (filters.vendorFilter) query = query.eq('vendor_id', filters.vendorFilter)
  if (filters.q) {
    query = query.or(
      `sku.ilike.%${filters.q}%,title.ilike.%${filters.q}%,colour.ilike.%${filters.q}%`,
    )
  }

  return unwrap(await query, 'the catalogue') as unknown as ReturnType<typeof demoProducts>
}

export async function listSeries(vendorId: string | null = null) {
  if (isDemoMode()) return demoSeries(vendorId)

  const supabase = await createClient()
  let query = supabase
    .from('product_series')
    .select('id, vendor_id, code, name, description, status')
    .is('deleted_at', null)
    .order('name')

  if (vendorId) query = query.eq('vendor_id', vendorId)

  return unwrap(await query, 'design series') as unknown as ReturnType<typeof demoSeries>
}
