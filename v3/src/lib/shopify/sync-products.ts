import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { runBulkQuery, shopifyConfig, ShopifyError } from './client'
import { vendorCodeFromSku } from '@/lib/seed/load'
import { resolveProductImage, DEFAULT_IMAGE_POSITION } from '@/lib/products/image'

/**
 * The half-hourly refresh of `products` from Shopify.
 *
 * The bulk query asks for products, their variants and their images in one
 * pass. Shopify returns this as JSONL where children are separate lines linked
 * to their parent by `__parentId` — so the reassembly below is not incidental,
 * it is the format.
 *
 * `inventoryQuantity` on the variant is Shopify's number and it is NOT the one
 * this portal trusts long-term. EasyEcom `Available` is, because it excludes
 * pieces reserved against open customer orders — the number that answers "do we
 * still have one". Until that endpoint is wired, Shopify's is what there is,
 * and `stock_synced_at` is stamped so every screen shows how old it is rather
 * than presenting it as live.
 */

const PRODUCTS_QUERY = `
{
  products {
    edges {
      node {
        id
        title
        status
        productType
        descriptionHtml
        images(first: 20) { edges { node { url } } }
        variants(first: 1) {
          edges {
            node {
              id
              sku
              price
              inventoryQuantity
              inventoryItem { unitCost { amount } }
            }
          }
        }
      }
    }
  }
}
`

interface BulkNode {
  id: string
  __parentId?: string
  // product
  title?: string
  status?: string
  productType?: string
  descriptionHtml?: string
  // image
  url?: string
  // variant
  sku?: string
  price?: string
  inventoryQuantity?: number
  inventoryItem?: { unitCost?: { amount?: string } | null } | null
}

export interface SyncResult {
  rowsSeen: number
  rowsChanged: number
  deactivated: number
  skipped: { reason: string; count: number }[]
}

interface ProductUpsert {
  sku: string
  vendor_code: string
  shopify_product_id: string
  shopify_variant_id: string | null
  title: string | null
  description: string | null
  product_type: string | null
  shopify_status: string | null
  price: string | null
  cost: string | null
  qty_available: number
  image_urls: string[]
}

/** Shopify sends HTML; nothing in this system renders HTML. */
function toPlainText(html: string | undefined): string | null {
  if (!html) return null
  const text = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return text || null
}

/** Mirrors the CHECK constraint on vendors.code. */
const VENDOR_CODE = /^[A-Z0-9][A-Z0-9_-]{1,15}$/

/**
 * `DMG` marks damage, not a weaver — the same rule the CSV loader applies, and
 * for the same reason. A damaged saree sold off cheap is not a design anyone
 * can be asked to make again, and turning `DMG` into a vendor invents a weaver
 * who cannot be sent an order.
 */
const DAMAGE_MARKERS = new Set(['DMG', 'SAREE'])

export async function syncShopifyProducts(
  db: SupabaseClient,
  opts: { onProgress?: (message: string) => void } = {},
): Promise<SyncResult> {
  const say = opts.onProgress ?? (() => {})
  const config = shopifyConfig()

  if (!config) {
    throw new ShopifyError(
      'Shopify is not connected. Set SHOPIFY_SHOP_DOMAIN and SHOPIFY_ADMIN_ACCESS_TOKEN in .env.local — see v3/docs/shopify-setup.md.',
    )
  }

  const nodes = await runBulkQuery<BulkNode>(config, PRODUCTS_QUERY, { onProgress: say })
  say(`${nodes.length} JSONL rows`)

  // --- Reassemble the parent/child stream -----------------------------------
  const products = new Map<string, BulkNode>()
  const images = new Map<string, string[]>()
  const variants = new Map<string, BulkNode>()

  for (const node of nodes) {
    if (!node.__parentId) {
      products.set(node.id, node)
      continue
    }
    if (node.url) {
      const list = images.get(node.__parentId) ?? []
      list.push(node.url)
      images.set(node.__parentId, list)
      continue
    }
    // A variant. Only the first is asked for — this catalogue is one variant per
    // design, because a SKU IS the design.
    if (!variants.has(node.__parentId)) variants.set(node.__parentId, node)
  }

  // --- Map to rows -----------------------------------------------------------
  const rows: ProductUpsert[] = []
  const skipped = new Map<string, number>()
  const skip = (reason: string) => skipped.set(reason, (skipped.get(reason) ?? 0) + 1)
  const seen = new Set<string>()

  for (const [id, product] of products) {
    const variant = variants.get(id)
    // Stored verbatim, never normalised. Some SKUs are malformed ('DMG - 157')
    // and rewriting one would put a code on a saree that matches nothing in
    // EasyEcom.
    const sku = (variant?.sku ?? '').trim()

    if (!sku) {
      skip('no SKU on the variant')
      continue
    }
    if (seen.has(sku)) {
      // Two products claiming one primary key. Either could be the real saree,
      // so neither is guessed at — the first wins and the collision is counted.
      skip('duplicate SKU in Shopify')
      continue
    }

    const vendorCode = vendorCodeFromSku(sku)
    if (DAMAGE_MARKERS.has(vendorCode)) {
      skip('damaged stock, not a weaver')
      continue
    }
    if (!VENDOR_CODE.test(vendorCode)) {
      skip('SKU prefix is not a usable vendor code')
      continue
    }

    seen.add(sku)

    rows.push({
      sku,
      vendor_code: vendorCode,
      shopify_product_id: id,
      shopify_variant_id: variant?.id ?? null,
      title: product.title?.trim() || null,
      // Kept in the database and shown in the admin product view. No vendor
      // screen renders it — see the note on DesignCard.
      description: toPlainText(product.descriptionHtml),
      product_type: product.productType?.trim() || null,
      // Recorded as fact, never acted on. Shopify drafts a product the moment
      // it sells out, and those are the strongest reorder candidates there are.
      shopify_status: product.status?.toLowerCase() ?? null,
      price: variant?.price ?? null,
      cost: variant?.inventoryItem?.unitCost?.amount ?? null,
      qty_available: variant?.inventoryQuantity ?? 0,
      image_urls: images.get(id) ?? [],
    })
  }

  say(`${rows.length} products to write`)

  const syncedAt = new Date().toISOString()
  const changed = await writeProducts(db, rows, syncedAt)
  const deactivated = await deactivateMissing(db, syncedAt)

  return {
    rowsSeen: rows.length,
    rowsChanged: changed,
    deactivated,
    skipped: [...skipped].map(([reason, count]) => ({ reason, count })),
  }
}

/**
 * Upsert, in chunks, through an RPC that does the vendor lookup and the
 * manual-override protection in one statement.
 *
 * Doing this from TypeScript would mean reading every existing row first to
 * find out which have a `manual_image_url`, then writing back around them —
 * two round trips per chunk and a race in between. The database already knows.
 */
async function writeProducts(
  db: SupabaseClient,
  rows: ProductUpsert[],
  syncedAt: string,
): Promise<number> {
  const CHUNK = 500
  let changed = 0

  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK)

    const { data, error } = await db.rpc('sync_upsert_products', {
      p_rows: chunk.map((row) => ({
        ...row,
        // Denormalised here so 120 grid tiles do not each evaluate the rule.
        // The database keeps a manual override in place regardless of what this
        // says — see the RPC.
        display_image_url: resolveProductImage({
          imageUrls: row.image_urls,
          displayImagePosition: DEFAULT_IMAGE_POSITION,
          manualImageUrl: null,
          cropJson: null,
          cropMode: 'top',
        }).url,
      })),
      p_synced_at: syncedAt,
    })

    if (error) throw new ShopifyError(`Could not write products: ${error.message}`)
    changed += Number(data ?? 0)
  }

  return changed
}

/**
 * Anything Shopify stopped returning is marked inactive, never deleted.
 *
 * Identified by `last_synced_at` older than this run rather than by diffing
 * id sets, so a product that failed to write for any reason is not silently
 * retired as a side effect.
 */
async function deactivateMissing(db: SupabaseClient, syncedAt: string): Promise<number> {
  const { data, error } = await db.rpc('sync_deactivate_missing', { p_synced_at: syncedAt })
  if (error) throw new ShopifyError(`Could not mark missing products inactive: ${error.message}`)
  return Number(data ?? 0)
}
