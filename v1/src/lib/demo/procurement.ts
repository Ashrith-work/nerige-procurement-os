import 'server-only'
import type { SessionUser } from '@/lib/auth/session'

/**
 * DEMO MODE — procurement data for the walkthrough.
 *
 * Extends the vendor-master demo data in ./index.ts to the rest of the weekly
 * cycle, so all three roles can be seen working without provisioning a Supabase
 * project first.
 *
 * Two rules this data follows, because a demo that breaks either of them
 * teaches the wrong thing:
 *
 *   1. Every dashboard section has at least one row, and every row is one a
 *      real week would produce. A demo where half the screen is empty states
 *      does not show whether the design works.
 *   2. Dates are relative to today. An order that was "late" when the fixtures
 *      were written but is three months stale by the time anyone looks reads as
 *      broken rather than as a demo.
 *
 * Nothing here is written to. Actions refuse politely in demo mode — see
 * `demoWriteRefusal()` — because a tour where the buttons silently do nothing
 * is worse than one that says why.
 */

const SHAN = '10000000-0000-4000-8000-000000000001'
const ILKAL = '10000000-0000-4000-8000-000000000002'

/** ISO date `n` days from today. Negative is in the past. */
function day(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

/** ISO timestamp `n` days from now. */
function stamp(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return d.toISOString()
}

// -----------------------------------------------------------------------------
// Who you can sign in as
// -----------------------------------------------------------------------------

/**
 * One login per role, because the whole point of the walkthrough is that the
 * three people see three different systems. A single demo account would show
 * the Founder's view and hide the two screens that actually change how the
 * week runs.
 */
export const DEMO_USERS: Record<string, SessionUser> = {
  founder: {
    id: '00000000-0000-4000-8000-000000000001',
    role: 'founder',
    fullName: 'Ashrith (Founder)',
    email: 'founder@nerigestory.test',
    phone: null,
    locale: 'en',
    vendorId: null,
    vendorName: null,
  },
  procurement_head: {
    id: '00000000-0000-4000-8000-000000000002',
    role: 'procurement_head',
    fullName: 'Pooja (Procurement)',
    email: 'pooja@nerigestory.test',
    phone: null,
    locale: 'en',
    vendorId: null,
    vendorName: null,
  },
  warehouse_manager: {
    id: '00000000-0000-4000-8000-000000000003',
    role: 'warehouse_manager',
    fullName: 'Ravi (Warehouse)',
    email: 'warehouse@nerigestory.test',
    phone: null,
    locale: 'en',
    vendorId: null,
    vendorName: null,
  },
  vendor: {
    id: '00000000-0000-4000-8000-000000000004',
    role: 'vendor',
    fullName: 'Shantiniketan Owner',
    email: null,
    phone: '+919000000001',
    locale: 'en',
    vendorId: SHAN,
    vendorName: 'Shantiniketan Handlooms',
  },
}

export type DemoRole = keyof typeof DEMO_USERS

export function isDemoRole(value: string | undefined): value is DemoRole {
  return value !== undefined && value in DEMO_USERS
}

// -----------------------------------------------------------------------------
// Catalogue
// -----------------------------------------------------------------------------

export interface DemoSeries {
  id: string
  vendor_id: string
  code: string
  name: string
  description: string | null
  status: string
}

export interface DemoProduct {
  id: string
  vendor_id: string
  series_id: string | null
  sku: string
  title: string
  colour: string | null
  fabric: string | null
  variant_note: string | null
  status: string
  cost_price: string | null
  mrp: string | null
  gst_rate: string
  last_ordered_at: string | null
  units_ordered_total: number
  units_sold_30d: number | null
  units_sold_90d: number | null
  sales_synced_at: string | null
}

const SERIES: DemoSeries[] = [
  {
    id: '20000000-0000-4000-8000-000000000001',
    vendor_id: SHAN,
    code: 'WB',
    name: 'Woven Border',
    description: 'Mustard body, maroon border, gold zari. The steady seller.',
    status: 'active',
  },
  {
    id: '20000000-0000-4000-8000-000000000002',
    vendor_id: SHAN,
    code: 'TB',
    name: 'Temple Border',
    description: 'Fine temple border with a contrast pallu.',
    status: 'active',
  },
  {
    id: '20000000-0000-4000-8000-000000000003',
    vendor_id: ILKAL,
    code: 'IK',
    name: 'Ilkal Classic',
    description: 'Traditional Ilkal with kasuti pallu.',
    status: 'active',
  },
]

const PRODUCTS: DemoProduct[] = [
  {
    id: '30000000-0000-4000-8000-000000000001',
    vendor_id: SHAN,
    series_id: SERIES[0].id,
    sku: 'shanwb14090',
    title: 'Woven border saree — mustard',
    colour: 'Mustard',
    fabric: 'Cotton silk',
    variant_note: 'Wide zari border',
    status: 'active',
    cost_price: '1450.00',
    mrp: '3499.00',
    gst_rate: '5',
    last_ordered_at: stamp(-9),
    units_ordered_total: 240,
    units_sold_30d: 31,
    units_sold_90d: 88,
    sales_synced_at: stamp(-1),
  },
  {
    id: '30000000-0000-4000-8000-000000000002',
    vendor_id: SHAN,
    series_id: SERIES[0].id,
    sku: 'shanwb14091',
    title: 'Woven border saree — indigo',
    colour: 'Indigo',
    fabric: 'Cotton silk',
    variant_note: 'Wide zari border',
    status: 'active',
    cost_price: '1450.00',
    mrp: '3499.00',
    gst_rate: '5',
    last_ordered_at: stamp(-9),
    units_ordered_total: 180,
    units_sold_30d: 44,
    units_sold_90d: 121,
    sales_synced_at: stamp(-1),
  },
  {
    id: '30000000-0000-4000-8000-000000000003',
    vendor_id: SHAN,
    series_id: SERIES[1].id,
    sku: 'shantb22010',
    title: 'Temple border saree — teal',
    colour: 'Teal',
    fabric: 'Soft silk',
    variant_note: 'Contrast rust pallu',
    status: 'active',
    cost_price: '1600.00',
    mrp: '3999.00',
    gst_rate: '5',
    last_ordered_at: stamp(-30),
    units_ordered_total: 60,
    // Slow mover, deliberately: the sell-through column is only interesting if
    // it can tell the vendor something they would not have guessed.
    units_sold_30d: 4,
    units_sold_90d: 19,
    sales_synced_at: stamp(-1),
  },
  {
    id: '30000000-0000-4000-8000-000000000004',
    vendor_id: ILKAL,
    series_id: SERIES[2].id,
    sku: 'ilkalik30012',
    title: 'Ilkal classic — pomegranate',
    colour: 'Pomegranate',
    fabric: 'Cotton',
    variant_note: 'Kasuti pallu',
    status: 'active',
    cost_price: '980.00',
    mrp: '2299.00',
    gst_rate: '5',
    last_ordered_at: stamp(-16),
    units_ordered_total: 300,
    units_sold_30d: 52,
    units_sold_90d: 160,
    sales_synced_at: stamp(-1),
  },
]

// -----------------------------------------------------------------------------
// Orders
// -----------------------------------------------------------------------------

export interface DemoOrder {
  id: string
  vendor_id: string
  po_number: string
  status: string
  title: string | null
  required_by: string | null
  promised_date: string | null
  instructions: string | null
  issued_at: string | null
  acknowledged_at: string | null
  dispatched_at: string | null
  transporter: string | null
  docket_number: string | null
  parcel_count: number | null
  received_at: string | null
  closed_at: string | null
  cancellation_reason: string | null
  subtotal_amount: string
  tax_amount: string
  total_amount: string
}

export interface DemoLine {
  id: string
  purchase_order_id: string
  vendor_id: string
  line_no: number
  kind: 'restock' | 'new_design'
  product_id: string | null
  series_id: string | null
  description: string | null
  colours: string[]
  quantity: number
  unit_price: string
  gst_rate: string
  quantity_received: number
  line_subtotal: string
  line_tax: string
  line_total: string
}

/** Builds a line with the same arithmetic the database's generated columns use. */
function line(
  id: string,
  order: string,
  vendorId: string,
  lineNo: number,
  spec: {
    kind: 'restock' | 'new_design'
    productId?: string
    seriesId?: string
    description?: string
    colours?: string[]
    quantity: number
    unitPrice: number
    received?: number
  },
): DemoLine {
  const subtotal = spec.quantity * spec.unitPrice
  const tax = Math.round(subtotal * 5) / 100
  return {
    id,
    purchase_order_id: order,
    vendor_id: vendorId,
    line_no: lineNo,
    kind: spec.kind,
    product_id: spec.productId ?? null,
    series_id: spec.seriesId ?? null,
    description: spec.description ?? null,
    colours: spec.colours ?? [],
    quantity: spec.quantity,
    unit_price: spec.unitPrice.toFixed(2),
    gst_rate: '5',
    quantity_received: spec.received ?? 0,
    line_subtotal: subtotal.toFixed(2),
    line_tax: tax.toFixed(2),
    line_total: (subtotal + tax).toFixed(2),
  }
}

const LINES: DemoLine[] = []

/** Creates an order and sums its header totals from the lines, as the trigger does. */
function order(
  spec: Omit<DemoOrder, 'subtotal_amount' | 'tax_amount' | 'total_amount'>,
  lines: DemoLine[],
): DemoOrder {
  LINES.push(...lines)
  const subtotal = lines.reduce((n, l) => n + Number(l.line_subtotal), 0)
  const tax = lines.reduce((n, l) => n + Number(l.line_tax), 0)
  return {
    ...spec,
    subtotal_amount: subtotal.toFixed(2),
    tax_amount: tax.toFixed(2),
    total_amount: (subtotal + tax).toFixed(2),
  }
}

const O1 = '40000000-0000-4000-8000-000000000001'
const O2 = '40000000-0000-4000-8000-000000000002'
const O3 = '40000000-0000-4000-8000-000000000003'
const O4 = '40000000-0000-4000-8000-000000000004'
const O5 = '40000000-0000-4000-8000-000000000005'
const O6 = '40000000-0000-4000-8000-000000000006'
const O7 = '40000000-0000-4000-8000-000000000007'

const blank = {
  promised_date: null,
  acknowledged_at: null,
  dispatched_at: null,
  transporter: null,
  docket_number: null,
  parcel_count: null,
  received_at: null,
  closed_at: null,
  cancellation_reason: null,
}

/**
 * One order in each state the system distinguishes, so every list on every
 * dashboard has something in it and the walkthrough shows the whole cycle
 * rather than one slice of it.
 */
const ORDERS: DemoOrder[] = [
  // Sent three days ago, no response — Procurement's "chase this" list.
  order(
    {
      ...blank,
      id: O1,
      vendor_id: SHAN,
      po_number: 'PO-2608-0001',
      status: 'issued',
      title: 'Week of 11 Aug',
      required_by: day(11),
      instructions: 'Write the SKU code on every piece before packing.',
      issued_at: stamp(-3),
    },
    [
      line(`${O1}-1`, O1, SHAN, 1, {
        kind: 'restock',
        productId: PRODUCTS[0].id,
        quantity: 40,
        unitPrice: 1450,
      }),
      line(`${O1}-2`, O1, SHAN, 2, {
        kind: 'new_design',
        seriesId: SERIES[1].id,
        description:
          'New series: teal body, gold temple border, fine zari pallu. Same weight as the WB series.',
        colours: ['Teal', 'Rust', 'Olive', 'Maroon'],
        quantity: 30,
        unitPrice: 1600,
      }),
    ],
  ),

  // Accepted, being woven, and past the date the vendor promised — the "late" list.
  order(
    {
      ...blank,
      id: O2,
      vendor_id: SHAN,
      po_number: 'PO-2608-0002',
      status: 'in_production',
      title: 'Onam restock',
      required_by: day(-6),
      promised_date: day(-2),
      instructions: null,
      issued_at: stamp(-24),
      acknowledged_at: stamp(-23),
    },
    [
      line(`${O2}-1`, O2, SHAN, 1, {
        kind: 'restock',
        productId: PRODUCTS[1].id,
        quantity: 60,
        unitPrice: 1450,
      }),
    ],
  ),

  // On a lorry right now — the warehouse's "count these in" list.
  order(
    {
      ...blank,
      id: O3,
      vendor_id: ILKAL,
      po_number: 'PO-2608-0003',
      status: 'dispatched',
      title: 'Ilkal weekly',
      required_by: day(3),
      promised_date: day(2),
      instructions: 'Pack in two bundles, code visible on the outer wrap.',
      issued_at: stamp(-12),
      acknowledged_at: stamp(-11),
      dispatched_at: stamp(-2),
      transporter: 'VRL Logistics',
      docket_number: 'VRL-88213',
      parcel_count: 3,
    },
    [
      line(`${O3}-1`, O3, ILKAL, 1, {
        kind: 'restock',
        productId: PRODUCTS[3].id,
        quantity: 80,
        unitPrice: 980,
      }),
    ],
  ),

  // Counted in, nothing billed — the gap the founder named outright.
  order(
    {
      ...blank,
      id: O4,
      vendor_id: SHAN,
      po_number: 'PO-2608-0004',
      status: 'received',
      title: 'Temple border first lot',
      required_by: day(-10),
      promised_date: day(-9),
      instructions: null,
      issued_at: stamp(-34),
      acknowledged_at: stamp(-33),
      dispatched_at: stamp(-12),
      transporter: 'Rajdhani Roadlines',
      docket_number: 'RR-40021',
      parcel_count: 2,
      received_at: stamp(-8),
    },
    [
      line(`${O4}-1`, O4, SHAN, 1, {
        kind: 'restock',
        productId: PRODUCTS[2].id,
        quantity: 25,
        unitPrice: 1600,
        received: 25,
      }),
    ],
  ),

  // Part delivered and billed short — the bill sitting in the review queue.
  order(
    {
      ...blank,
      id: O5,
      vendor_id: SHAN,
      po_number: 'PO-2608-0005',
      status: 'partially_received',
      title: 'Woven border top-up',
      required_by: day(-2),
      promised_date: day(-3),
      instructions: null,
      issued_at: stamp(-20),
      acknowledged_at: stamp(-19),
      dispatched_at: stamp(-6),
      transporter: 'VRL Logistics',
      docket_number: 'VRL-88104',
      parcel_count: 2,
    },
    [
      line(`${O5}-1`, O5, SHAN, 1, {
        kind: 'restock',
        productId: PRODUCTS[0].id,
        quantity: 40,
        unitPrice: 1450,
        received: 38,
      }),
    ],
  ),

  // Done and paid — proves the cycle terminates.
  order(
    {
      ...blank,
      id: O6,
      vendor_id: ILKAL,
      po_number: 'PO-2607-0009',
      status: 'closed',
      title: 'July second drop',
      required_by: day(-30),
      promised_date: day(-30),
      instructions: null,
      issued_at: stamp(-52),
      acknowledged_at: stamp(-51),
      dispatched_at: stamp(-34),
      transporter: 'VRL Logistics',
      docket_number: 'VRL-87550',
      parcel_count: 4,
      received_at: stamp(-30),
      closed_at: stamp(-12),
    },
    [
      line(`${O6}-1`, O6, ILKAL, 1, {
        kind: 'restock',
        productId: PRODUCTS[3].id,
        quantity: 100,
        unitPrice: 980,
        received: 100,
      }),
    ],
  ),

  // Being assembled — invisible to the vendor, which is the point of it.
  order(
    {
      ...blank,
      id: O7,
      vendor_id: SHAN,
      po_number: 'PO-2608-0007',
      status: 'draft',
      title: 'Week of 18 Aug',
      required_by: day(18),
      instructions: null,
      issued_at: null,
    },
    [
      line(`${O7}-1`, O7, SHAN, 1, {
        kind: 'restock',
        productId: PRODUCTS[1].id,
        quantity: 25,
        unitPrice: 1450,
      }),
    ],
  ),
]

// -----------------------------------------------------------------------------
// Receipts, bills and the order thread
// -----------------------------------------------------------------------------

export interface DemoReceipt {
  id: string
  vendor_id: string
  purchase_order_id: string
  grn_number: string
  status: string
  received_on: string
  parcel_count: number | null
  docket_number: string | null
  notes: string | null
  posted_at: string | null
}

export interface DemoReceiptLine {
  id: string
  goods_receipt_id: string
  vendor_id: string
  purchase_order_line_id: string
  product_id: string | null
  quantity_ordered: number
  quantity_received: number
  quantity_damaged: number
  notes: string | null
}

const RECEIPTS: DemoReceipt[] = [
  {
    id: '50000000-0000-4000-8000-000000000001',
    vendor_id: SHAN,
    purchase_order_id: O4,
    grn_number: 'GRN-2608-0001',
    status: 'posted',
    received_on: day(-8),
    parcel_count: 2,
    docket_number: 'RR-40021',
    notes: null,
    posted_at: stamp(-8),
  },
  {
    id: '50000000-0000-4000-8000-000000000002',
    vendor_id: SHAN,
    purchase_order_id: O5,
    grn_number: 'GRN-2608-0002',
    status: 'posted',
    received_on: day(-4),
    parcel_count: 2,
    docket_number: 'VRL-88104',
    notes: 'Two pieces stained along the border, counted as damaged.',
    posted_at: stamp(-4),
  },
  {
    id: '50000000-0000-4000-8000-000000000003',
    vendor_id: ILKAL,
    purchase_order_id: O6,
    grn_number: 'GRN-2607-0011',
    status: 'posted',
    received_on: day(-30),
    parcel_count: 4,
    docket_number: 'VRL-87550',
    notes: null,
    posted_at: stamp(-30),
  },
]

const RECEIPT_LINES: DemoReceiptLine[] = [
  {
    id: '51000000-0000-4000-8000-000000000001',
    goods_receipt_id: RECEIPTS[0].id,
    vendor_id: SHAN,
    purchase_order_line_id: `${O4}-1`,
    product_id: PRODUCTS[2].id,
    quantity_ordered: 25,
    quantity_received: 25,
    quantity_damaged: 0,
    notes: null,
  },
  {
    id: '51000000-0000-4000-8000-000000000002',
    goods_receipt_id: RECEIPTS[1].id,
    vendor_id: SHAN,
    purchase_order_line_id: `${O5}-1`,
    product_id: PRODUCTS[0].id,
    quantity_ordered: 40,
    quantity_received: 38,
    quantity_damaged: 2,
    notes: 'Border staining on two pieces.',
  },
  {
    id: '51000000-0000-4000-8000-000000000003',
    goods_receipt_id: RECEIPTS[2].id,
    vendor_id: ILKAL,
    purchase_order_line_id: `${O6}-1`,
    product_id: PRODUCTS[3].id,
    quantity_ordered: 100,
    quantity_received: 100,
    quantity_damaged: 0,
    notes: null,
  },
]

export interface DemoBill {
  id: string
  vendor_id: string
  purchase_order_id: string
  bill_number: string
  bill_date: string
  due_date: string | null
  status: string
  subtotal_amount: string
  tax_amount: string
  total_amount: string
  matched_received_value: string | null
  variance_amount: string | null
  variance_note: string | null
  payment_reference: string | null
  reviewed_at: string | null
  approved_at: string | null
  paid_at: string | null
  document_id: string
}

const BILLS: DemoBill[] = [
  // Billed for all 40 when 38 arrived and 2 were damaged. The variance the
  // three-way match exists to surface.
  {
    id: '60000000-0000-4000-8000-000000000001',
    vendor_id: SHAN,
    purchase_order_id: O5,
    bill_number: 'SH/0042',
    bill_date: day(-4),
    due_date: day(26),
    status: 'submitted',
    subtotal_amount: '58000.00',
    tax_amount: '2900.00',
    total_amount: '60900.00',
    matched_received_value: '57855.00',
    variance_amount: '3045.00',
    variance_note: null,
    payment_reference: null,
    reviewed_at: null,
    approved_at: null,
    paid_at: null,
    document_id: '70000000-0000-4000-8000-000000000001',
  },
  // MSME supplier, due inside a week — the statutory clock made visible.
  {
    id: '60000000-0000-4000-8000-000000000002',
    vendor_id: ILKAL,
    purchase_order_id: O6,
    bill_number: 'IK-118',
    bill_date: day(-40),
    due_date: day(5),
    status: 'approved',
    subtotal_amount: '98000.00',
    tax_amount: '4900.00',
    total_amount: '102900.00',
    matched_received_value: '102900.00',
    variance_amount: '0.00',
    variance_note: null,
    payment_reference: null,
    reviewed_at: stamp(-38),
    approved_at: stamp(-36),
    paid_at: null,
    document_id: '70000000-0000-4000-8000-000000000002',
  },
]

export interface DemoMessage {
  id: string
  purchase_order_id: string
  vendor_id: string
  author_id: string | null
  body: string
  is_internal: boolean
  created_at: string
  app_users: { full_name: string; role: string } | null
}

const MESSAGES: DemoMessage[] = [
  {
    id: '80000000-0000-4000-8000-000000000001',
    purchase_order_id: O1,
    vendor_id: SHAN,
    author_id: DEMO_USERS.procurement_head.id,
    body: 'Please label every piece with the SKU on the order before packing.',
    is_internal: false,
    created_at: stamp(-3),
    app_users: { full_name: 'Pooja (Procurement)', role: 'procurement_head' },
  },
  {
    id: '80000000-0000-4000-8000-000000000002',
    purchase_order_id: O1,
    vendor_id: SHAN,
    author_id: DEMO_USERS.procurement_head.id,
    body: 'Check quality on this lot — last consignment had loose zari.',
    is_internal: true,
    created_at: stamp(-3),
    app_users: { full_name: 'Pooja (Procurement)', role: 'procurement_head' },
  },
  {
    id: '80000000-0000-4000-8000-000000000003',
    purchase_order_id: O2,
    vendor_id: SHAN,
    author_id: DEMO_USERS.vendor.id,
    body: 'Two looms were down last week. Can we send 30 now and 30 on Friday?',
    is_internal: false,
    created_at: stamp(-4),
    app_users: { full_name: 'Shantiniketan Owner', role: 'vendor' },
  },
]

// -----------------------------------------------------------------------------
// Accessors
// -----------------------------------------------------------------------------
// Each returns the shape the corresponding PostgREST query returns, so a page
// can consume either source without knowing which it got.

const VENDOR_NAMES: Record<string, { display_name: string; code: string; msme_category: string }> = {
  [SHAN]: { display_name: 'Shantiniketan Handlooms', code: 'SHAN', msme_category: 'small' },
  [ILKAL]: { display_name: 'Ilkal Weavers Co-op', code: 'ILKAL', msme_category: 'micro' },
}

/** Vendors only ever see their own rows — the same rule RLS enforces for real. */
function scope<T extends { vendor_id: string }>(rows: T[], vendorId: string | null): T[] {
  return vendorId ? rows.filter((r) => r.vendor_id === vendorId) : rows
}

export function demoOrders(vendorId: string | null): (DemoOrder & {
  vendors: { display_name: string; code: string } | null
  purchase_order_lines: { quantity: number; quantity_received: number }[]
})[] {
  return scope(ORDERS, vendorId)
    // A draft order is invisible to the vendor. Mirrored here so the demo does
    // not accidentally teach that it is visible.
    .filter((o) => !(vendorId && o.status === 'draft'))
    .map((o) => ({
      ...o,
      vendors: VENDOR_NAMES[o.vendor_id] ?? null,
      purchase_order_lines: LINES.filter((l) => l.purchase_order_id === o.id).map((l) => ({
        quantity: l.quantity,
        quantity_received: l.quantity_received,
      })),
    }))
}

export function demoOrder(id: string, vendorId: string | null) {
  const found = ORDERS.find((o) => o.id === id)
  if (!found) return null
  if (vendorId && (found.vendor_id !== vendorId || found.status === 'draft')) return null
  return { ...found, vendors: VENDOR_NAMES[found.vendor_id] ?? null }
}

export function demoOrderLines(orderId: string) {
  return LINES.filter((l) => l.purchase_order_id === orderId).map((l) => ({
    ...l,
    products: l.product_id
      ? (() => {
          const p = PRODUCTS.find((x) => x.id === l.product_id)!
          return { sku: p.sku, title: p.title, colour: p.colour }
        })()
      : null,
    product_series: l.series_id
      ? { name: SERIES.find((s) => s.id === l.series_id)?.name ?? 'Series' }
      : null,
  }))
}

export function demoMessages(orderId: string, includeInternal: boolean) {
  return MESSAGES.filter(
    (m) => m.purchase_order_id === orderId && (includeInternal || !m.is_internal),
  )
}

export function demoReceipts(filter: { orderId?: string; vendorId?: string | null } = {}) {
  let rows = RECEIPTS
  if (filter.orderId) rows = rows.filter((r) => r.purchase_order_id === filter.orderId)
  if (filter.vendorId) rows = rows.filter((r) => r.vendor_id === filter.vendorId)
  return rows.map((r) => ({
    ...r,
    purchase_orders: (() => {
      const o = ORDERS.find((x) => x.id === r.purchase_order_id)
      return o
        ? { po_number: o.po_number, vendors: VENDOR_NAMES[o.vendor_id] ?? null }
        : null
    })(),
    goods_receipt_lines: RECEIPT_LINES.filter((l) => l.goods_receipt_id === r.id),
  }))
}

export function demoBills(vendorId: string | null) {
  return scope(BILLS, vendorId).map((b) => ({
    ...b,
    vendors: VENDOR_NAMES[b.vendor_id] ?? null,
    purchase_orders: (() => {
      const o = ORDERS.find((x) => x.id === b.purchase_order_id)
      return o ? { po_number: o.po_number, total_amount: o.total_amount } : null
    })(),
  }))
}

export function demoBill(id: string) {
  return demoBills(null).find((b) => b.id === id) ?? null
}

export function demoProducts(filters: { vendorId?: string | null; q?: string } = {}) {
  let rows = filters.vendorId ? PRODUCTS.filter((p) => p.vendor_id === filters.vendorId) : PRODUCTS
  if (filters.q) {
    const q = filters.q.toLowerCase()
    rows = rows.filter(
      (p) =>
        p.sku.toLowerCase().includes(q) ||
        p.title.toLowerCase().includes(q) ||
        (p.colour ?? '').toLowerCase().includes(q),
    )
  }
  return rows.map((p) => ({
    ...p,
    vendors: VENDOR_NAMES[p.vendor_id] ?? null,
    product_series: p.series_id
      ? { name: SERIES.find((s) => s.id === p.series_id)?.name ?? 'Series' }
      : null,
  }))
}

export function demoSeries(vendorId: string | null) {
  return scope(SERIES, vendorId)
}

/**
 * What a write attempt says in demo mode.
 *
 * Stated rather than silently ignored: a walkthrough where buttons appear to
 * work but change nothing is how someone concludes the system is broken.
 */
export function demoWriteRefusal(): string {
  return 'Demo mode — this is sample data and nothing is saved. Connect a Supabase project to make changes.'
}
