import { notFound } from 'next/navigation'
import Link from 'next/link'
import { format } from 'date-fns'
import { requireProcurement } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { PageHeader, Card, Button, StatusBadge } from '@/components/ui/primitives'
import { ImageEditor, type EditableProduct } from '../image-editor'

export const metadata = { title: 'Product · Nerige' }

/**
 * One design, as Nerige holds it.
 *
 * This is the only screen in the application that shows the Shopify
 * description. It is kept in the database and shown here because it is the
 * record of what the product IS — but it is written to sell a saree to a
 * customer ("a stunning pista green semi Bangalore silk with a peacock gold
 * zari border"), and neither a weaver about to make it again nor Pooja choosing
 * what to reorder is reading three lines of that. On a phone it pushed the code
 * and the quantity off the screen, which is why no vendor card carries it.
 */
export default async function AdminProductPage({ params }: { params: Promise<{ sku: string }> }) {
  const { sku } = await params
  await requireProcurement()
  const supabase = await createClient()

  const { data: product } = await supabase
    .from('products')
    .select(
      `sku, title, description, collection, fabric, colour_code, seq, product_type,
       shopify_status, shopify_product_id, price, cost, qty_available, stock_synced_at,
       is_active, last_synced_at, image_url, image_urls, display_image_position,
       manual_image_url, crop_json, crop_mode,
       units_30d, units_60d, units_90d, units_365d, last_sold_at,
       vendors ( code, display_name )`,
    )
    .eq('sku', decodeURIComponent(sku))
    .maybeSingle()

  if (!product) notFound()

  type V = { code: string; display_name: string }
  const embedded = product.vendors as V | V[] | null
  const vendor = Array.isArray(embedded) ? embedded[0] : embedded

  return (
    <div className="max-w-4xl space-y-5">
      <PageHeader
        title={product.title ?? product.sku}
        subtitle={product.sku}
        action={
          vendor && (
            <Link href={`/admin/vendors/${encodeURIComponent(vendor.code)}`}>
              <Button variant="secondary">{vendor.display_name}</Button>
            </Link>
          )
        }
      />

      {!product.is_active && (
        <Card className="border-amber-300 bg-amber-50 text-sm text-amber-900">
          Shopify stopped returning this design on the last sync. It is kept rather than deleted —
          orders may still point at it.
        </Card>
      )}

      <ImageEditor product={product as unknown as EditableProduct} />

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Sold, 30 days" value={product.units_30d ?? 0} />
        <Stat label="60 days" value={product.units_60d ?? 0} />
        <Stat label="90 days" value={product.units_90d ?? 0} />
        <Stat label="A year" value={product.units_365d ?? 0} />
      </div>

      <Card className="space-y-3">
        <h2 className="text-base font-medium text-stone-900">Details</h2>

        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <Row label="Collection" value={product.collection} />
          <Row label="Fabric" value={product.fabric} />
          <Row label="Colour" value={product.colour_code} />
          <Row label="Type" value={product.product_type} />
          <Row label="Price" value={product.price ? `₹${product.price}` : null} />
          <Row label="Cost" value={product.cost ? `₹${product.cost}` : null} />
          <Row label="In stock" value={String(product.qty_available)} />
          <Row
            label="Last sold"
            value={product.last_sold_at ? format(new Date(product.last_sold_at), 'd MMM yyyy') : 'Never'}
          />
          <Row
            label="Stock checked"
            value={
              product.stock_synced_at
                ? format(new Date(product.stock_synced_at), 'd MMM yyyy, HH:mm')
                : 'Never'
            }
          />
          <div className="flex gap-2">
            <dt className="text-stone-500">Shopify</dt>
            <dd>
              <StatusBadge
                status={product.shopify_status === 'active' ? 'active' : 'archived'}
                label={product.shopify_status ?? 'unknown'}
              />
            </dd>
          </div>
        </dl>
      </Card>

      {product.description && (
        <Card className="space-y-2">
          <div>
            <h2 className="text-base font-medium text-stone-900">Description</h2>
            <p className="text-sm text-stone-500">
              Shopify&rsquo;s customer-facing copy. Kept here, deliberately absent from every
              vendor card.
            </p>
          </div>
          <p className="text-sm leading-relaxed whitespace-pre-line text-stone-700">
            {product.description}
          </p>
        </Card>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-stone-200 px-3 py-2.5">
      <p className="text-xs text-stone-500">{label}</p>
      <p className="text-lg font-medium text-stone-900 tabular-nums">
        {value.toLocaleString('en-IN')}
      </p>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex gap-2">
      <dt className="text-stone-500">{label}</dt>
      <dd className="text-stone-900">{value ?? '—'}</dd>
    </div>
  )
}
