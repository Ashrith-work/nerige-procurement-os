import Link from 'next/link'
import { notFound } from 'next/navigation'
import { format } from 'date-fns'
import { requireStaff } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { getDictionary } from '@/lib/i18n'
import { Card, PageHeader, StatusBadge } from '@/components/ui/primitives'
import { Photo } from '@/components/design-card'
import { StockLine } from '@/components/stock-line'
import { resolveProductImage, type CropRect } from '@/lib/products/image'
import { todayInIndia } from '@/lib/inwarding/summary'

export const metadata = { title: 'Lookup · Nerige' }

/** The shape `public.lookup_product()` returns. No cost, by construction. */
interface LookupDetail {
  product: {
    sku: string
    title: string | null
    seq: number | null
    collection: string | null
    fabric: string | null
    colour_code: string | null
    product_type: string | null
    price: number | null
    is_active: boolean
    qty_available: number
    stock_synced_at: string | null
    image_url: string | null
    image_urls: string[] | null
    display_image_position: number | null
    manual_image_url: string | null
    crop_json: CropRect | null
    crop_mode: string | null
    units_30d: number
    units_90d: number
    units_365d: number
    last_sold_at: string | null
    sales_synced_at: string | null
    vendor_code: string
    vendor_name: string
  }
  recent_sales: { date: string; units: number; orders: number }[]
  open_orders: {
    order_number: string
    status: string
    issued_at: string
    promised_date: string | null
    dispatched_at: string | null
    quantity: number
    received: number
    vendor_name: string
  }[]
  recent_receipts: {
    received_at: string
    qty_received: number
    qty_rejected: number
    order_number: string
  }[]
  intake: {
    unique_code: number
    status: string
    img_status: string
    publish_status: string
    created_at: string
  } | null
}

/** Next may hand the segment over still encoded; decode once, and never throw on a stray '%'. */
function decodeSku(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

const date = (iso: string | null, pattern = 'd MMM yyyy') => (iso ? format(new Date(iso), pattern) : null)

/**
 * One saree, as support needs it on the phone: in stock or not (and how fresh
 * that number is), is it selling, is more coming and by when, and where it is
 * if it is not on the website yet.
 *
 * Read-only by construction: the page calls one STABLE function and renders
 * what it returns. Nothing on it links to a screen support cannot open.
 */
export default async function LookupDetailPage({ params }: { params: Promise<{ sku: string }> }) {
  const { sku: segment } = await params
  await requireStaff()
  const t = getDictionary('en')
  const sku = decodeSku(segment)

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('lookup_product', { p_sku: sku })
  if (error) throw new Error(`Lookup failed: ${error.message}`)
  if (!data) notFound()

  const { product: p, recent_sales, open_orders, recent_receipts, intake } = data as LookupDetail
  const image = resolveProductImage({
    imageUrls: p.image_urls,
    displayImagePosition: p.display_image_position,
    manualImageUrl: p.manual_image_url,
    cropJson: p.crop_json,
    cropMode: p.crop_mode,
    imageUrl: p.image_url,
  })
  const today = todayInIndia()

  return (
    <div className="max-w-3xl space-y-5">
      <Link
        href="/lookup"
        className="inline-block min-h-11 py-2.5 text-sm text-stone-500 underline underline-offset-2"
      >
        Back to search
      </Link>

      <PageHeader title={p.title ?? p.sku} subtitle={`${p.vendor_name} · ${p.vendor_code}`} />

      <div className="grid gap-5 sm:grid-cols-[240px_1fr]">
        <Photo url={image.url} alt={p.title ?? p.sku} crop={image.crop} className="h-[320px] w-full" />

        <div className="space-y-3">
          <p className="font-mono text-[19px] leading-tight font-medium break-words text-stone-900">
            {p.sku}
          </p>
          <StockLine qty={p.qty_available} syncedAt={p.stock_synced_at} t={t} />
          {p.qty_available < 0 && (
            <p className="text-sm text-amber-700">
              Oversold by {Math.abs(p.qty_available)}: that many customers have paid for one that
              is not in stock yet.
            </p>
          )}
          {!p.is_active && (
            <p className="text-sm text-amber-700">Shopify no longer lists this design.</p>
          )}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <Row label="Unique Code" value={intake?.unique_code ?? p.seq} />
            <Row label="Price" value={p.price !== null ? `₹${Number(p.price).toLocaleString('en-IN')}` : null} />
            <Row label="Collection" value={p.collection} />
            <Row label="Fabric" value={p.fabric} />
            <Row label="Colour" value={p.colour_code} />
            <Row label="Type" value={p.product_type} />
          </dl>
        </div>
      </div>

      <Card className="space-y-3">
        <h2 className="text-base font-medium text-stone-900">More on its way</h2>
        {open_orders.length === 0 ? (
          <p className="text-sm text-stone-500">No reorder is open for this design. Nothing more is on its way.</p>
        ) : (
          <ul className="divide-y divide-stone-100 text-sm">
            {open_orders.map((o) => {
              const late = o.status !== 'dispatched' && o.promised_date !== null && o.promised_date < today
              return (
                <li key={o.order_number} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    <span className="font-medium text-stone-900 tabular-nums">{o.quantity} pieces</span>
                    <span className="text-stone-500"> from {o.vendor_name}</span>
                    <span className="block text-stone-600">
                      {o.status === 'dispatched'
                        ? `Sent ${date(o.dispatched_at) ?? ''} — arriving at the warehouse soon`
                        : o.promised_date
                          ? `Promised by ${date(o.promised_date)}${late ? ' (late)' : ''}`
                          : 'Weaver has not given a date yet'}
                      {o.received > 0 && ` · ${o.received} already arrived`}
                    </span>
                  </span>
                  <StatusBadge status={o.status} />
                </li>
              )
            })}
          </ul>
        )}
        {recent_receipts.length > 0 && (
          <p className="text-sm text-stone-600">
            Last arrived:{' '}
            {recent_receipts
              .slice(0, 3)
              .map((r) => `${r.qty_received} on ${date(r.received_at, 'd MMM')}`)
              .join(', ')}
            .
          </p>
        )}
      </Card>

      <Card className="space-y-3">
        <h2 className="text-base font-medium text-stone-900">Sales</h2>
        {p.sales_synced_at ? (
          <>
            <div className="grid grid-cols-3 gap-3">
              <Stat label="30 days" value={p.units_30d} />
              <Stat label="90 days" value={p.units_90d} />
              <Stat label="A year" value={p.units_365d} />
            </div>
            <p className="text-sm text-stone-600">
              {p.last_sold_at ? `Last sold ${date(p.last_sold_at)}.` : 'Not sold in the sales history we hold.'}
            </p>
            {recent_sales.length > 0 && (
              <ul className="text-sm text-stone-600 tabular-nums">
                {recent_sales.map((s) => (
                  <li key={s.date}>
                    {date(s.date, 'd MMM yyyy')}: {s.units} sold
                    {s.orders > 1 && ` in ${s.orders} orders`}
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p className="text-sm text-stone-500">Sales have not been synced yet.</p>
        )}
      </Card>

      <Card className="space-y-2">
        <h2 className="text-base font-medium text-stone-900">Intake</h2>
        {intake ? (
          <p className="text-sm text-stone-700">
            Unique Code <span className="font-mono">{intake.unique_code}</span> · {humanise(intake.status)} ·
            photos {humanise(intake.img_status)} · {humanise(intake.publish_status)} · started{' '}
            {date(intake.created_at)}
          </p>
        ) : (
          <p className="text-sm text-stone-500">
            No intake record. This design was catalogued before intake existed in this system.
          </p>
        )}
      </Card>
    </div>
  )
}

function humanise(code: string): string {
  return code.toLowerCase().replace(/_/g, ' ')
}

function Row({ label, value }: { label: string; value: string | number | null }) {
  return (
    <div className="flex gap-2">
      <dt className="text-stone-500">{label}</dt>
      <dd className="text-stone-900">{value ?? '—'}</dd>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-stone-200 px-3 py-2.5">
      <p className="text-xs text-stone-500">{label}</p>
      <p className="text-lg font-medium text-stone-900 tabular-nums">{value.toLocaleString('en-IN')}</p>
    </div>
  )
}
