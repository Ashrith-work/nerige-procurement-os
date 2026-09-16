import Link from 'next/link'
import { requireAdmin } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { PageHeader, Select, Button, EmptyState } from '@/components/ui/primitives'
import { resolveProductImage, type CropRect } from '@/lib/products/image'
import { CropQueue, type QueueItem } from './crop-queue'

export const metadata = { title: 'Cropping · Nerige' }

/**
 * The queue of sarees a weaver will see that nobody has framed by hand.
 *
 * The default framing cuts the top 18% and the bottom 12% of the frame, which
 * is right for the catalogue's usual shot — a model against a plain ground,
 * head above and floor below. It is wrong often enough to matter: a seated
 * shot, a close-up of a pallu, a photograph taken portrait on a phone. On those
 * the weaver gets a face, or a floor, on the card she works from.
 *
 * ORDERED BY WHAT SELLS. A design nobody has bought in a year is unlikely to be
 * reordered, so its framing costs nothing; the fifty best-selling sarees are on
 * a screen somewhere every week. Cropping in that order means the first hour of
 * this work is worth more than the next ten.
 *
 * Admin only, like the full editor: a photograph is something a customer can
 * already see.
 */

const BATCH = 40

interface Row {
  sku: string
  title: string | null
  image_urls: string[] | null
  image_url: string | null
  display_image_position: number | null
  manual_image_url: string | null
  crop_json: CropRect | null
  crop_mode: string | null
  units_90d: number | null
  vendors: { code: string } | { code: string }[] | null
}

export default async function CroppingPage({
  searchParams,
}: {
  searchParams: Promise<{ vendor?: string; include?: string }>
}) {
  await requireAdmin()
  const params = await searchParams
  const supabase = await createClient()

  const vendorCode = (params.vendor ?? '').replace(/[^A-Za-z0-9_-]/g, '').toUpperCase()
  // "Everything" rather than only the unframed ones, for going back over work
  // already done — a crop drawn in a hurry is worth a second look.
  const includeCropped = params.include === 'all'

  const { data: vendorRows } = await supabase
    .from('vendors')
    .select('id, code, display_name, is_placeholder')
    .is('deleted_at', null)
    .order('code')

  const vendors = (vendorRows ?? []) as { id: string; code: string; display_name: string; is_placeholder: boolean }[]
  const chosen = vendors.find((v) => v.code === vendorCode)

  const base = () => {
    let q = supabase.from('products').select('sku', { count: 'exact', head: true }).eq('is_active', true)
    if (chosen) q = q.eq('vendor_id', chosen.id)
    return q
  }

  const [{ count: withoutCrop }, { count: total }, { data }] = await Promise.all([
    base().is('crop_json', null),
    base(),
    (() => {
      let q = supabase
        .from('products')
        .select(
          'sku, title, image_urls, image_url, display_image_position, manual_image_url, crop_json, crop_mode, units_90d, vendors(code)',
        )
        .eq('is_active', true)
      if (chosen) q = q.eq('vendor_id', chosen.id)
      if (!includeCropped) q = q.is('crop_json', null)
      // Nulls last: a design with no sales figure yet is not evidence of a
      // design that does not sell.
      return q.order('units_90d', { ascending: false, nullsFirst: false }).limit(BATCH)
    })(),
  ])

  const items: QueueItem[] = ((data ?? []) as Row[])
    .map((row) => {
      const resolved = resolveProductImage({
        imageUrls: row.image_urls,
        displayImagePosition: row.display_image_position,
        manualImageUrl: row.manual_image_url,
        cropJson: row.crop_json,
        cropMode: row.crop_mode,
        imageUrl: row.image_url,
      })
      const vendor = Array.isArray(row.vendors) ? row.vendors[0] : row.vendors
      return {
        sku: row.sku,
        title: row.title,
        url: resolved.url ?? '',
        vendorCode: vendor?.code ?? null,
        units90d: row.units_90d,
        crop: row.crop_json,
        cropMode: row.crop_mode,
      }
    })
    // A saree with no photograph at all cannot be framed; it belongs in the
    // full editor, where a URL can be pasted.
    .filter((item) => item.url !== '')

  return (
    <div className="space-y-5">
      <PageHeader
        title="Cropping"
        subtitle="How each saree is framed on the weaver's card, her catalogue, and the picture she is sent on WhatsApp."
        action={
          <Link href="/admin/products" className="text-sm text-stone-600 underline-offset-2 hover:underline">
            All products
          </Link>
        }
      />

      <form action="/admin/products/cropping" className="flex flex-wrap items-end gap-2">
        <Select name="vendor" defaultValue={vendorCode} className="w-auto min-w-48">
          <option value="">Every weaver</option>
          {vendors
            .filter((v) => !v.is_placeholder)
            .map((v) => (
              <option key={v.id} value={v.code}>
                {v.code} · {v.display_name}
              </option>
            ))}
        </Select>

        <Select name="include" defaultValue={includeCropped ? 'all' : 'todo'} className="w-auto min-w-52">
          <option value="todo">Not framed by hand yet</option>
          <option value="all">Everything, to go back over</option>
        </Select>

        <Button type="submit" variant="secondary">
          Show
        </Button>
      </form>

      <p className="text-sm text-stone-500">
        {(withoutCrop ?? 0).toLocaleString('en-IN')} of {(total ?? 0).toLocaleString('en-IN')} sarees
        {chosen ? ` at ${chosen.display_name}` : ''} still use the default framing. Best-selling first.
      </p>

      {items.length === 0 ? (
        <EmptyState
          title="Nothing to crop here"
          body={
            includeCropped
              ? 'No active sarees with a photograph match this selection.'
              : 'Every saree in this selection has been framed by hand. Switch to “Everything” to go back over them.'
          }
        />
      ) : (
        <CropQueue items={items} remaining={withoutCrop ?? 0} />
      )}
    </div>
  )
}
