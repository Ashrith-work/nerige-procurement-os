/**
 * The loader. This is the seam.
 *
 * Today it reads two CSV exports into Postgres. Later, EasyEcom's inventory
 * endpoint supplies `qty_available` and `stock_synced_at` and Shopify supplies
 * the words and photographs — and when that happens, this file changes and
 * nothing else does. Every screen in the application reads `products`, never a
 * CSV and never an API.
 *
 * Three rules the loader will not bend:
 *
 *  1. The SKU string is stored verbatim. Some are malformed ('DMG - 157', with
 *     spaces around the hyphen) but a SKU is copied onto a fabric label by
 *     hand, and silently rewriting one would put a code on a saree that
 *     matches nothing in EasyEcom.
 *
 *  2. The vendor is derived from the SKU prefix, and only from there. The
 *     `vendor_name` column in the export is unusable — the code HDR appears
 *     against nine different names, including 'SAREE MART' and 'NERIGE STORY'.
 *     The prefix is the fact; the name is decoration.
 *
 *  3. Shopify's `draft` status is recorded and never acted on. 8,338 of 9,840
 *     rows are draft, because Shopify drafts a product the moment it sells out.
 *     Excluding them would empty the reorder pool of exactly the designs that
 *     proved they sell.
 *
 * It refuses to guess. A SKU that appears twice stops the load; damaged stock
 * is set aside rather than turned into a weaver. Both are reported by name.
 */
import { readFile, stat } from 'node:fs/promises'
import { parseCsv } from './csv'

/** The subset of a `pg` Client this loader needs. Keeps the seam driver-agnostic. */
export interface Queryable {
  query(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>
}

export interface LoadOptions {
  productsCsvPath: string
  poolCsvPath: string
  /**
   * What `stock_synced_at` should say. Defaults to the products file's
   * modification time — the quantities are exactly as fresh as the export, and
   * claiming they were synced at load time would overstate them.
   */
  stockAsOf?: Date
  /**
   * Escape hatch for development against a known-broken export: keep the first
   * of each repeated SKU instead of refusing the load. Never set this for a
   * load into a database anyone reads.
   */
  allowDuplicateSkus?: boolean
  onProgress?: (message: string) => void
}

/**
 * Two SKUs in the same export, one primary key.
 *
 * Thrown rather than resolved, because either row could be the real saree and
 * picking one silently makes the other unorderable under its own name. The fix
 * is upstream in Shopify.
 */
export class DuplicateSkuError extends Error {
  constructor(readonly duplicates: { sku: string; keptTitle: string; droppedTitle: string }[]) {
    super(
      `${duplicates.length} SKU(s) appear more than once in the export: ` +
        duplicates.map((d) => d.sku).join(', '),
    )
    this.name = 'DuplicateSkuError'
  }
}

export interface LoadReport {
  stockAsOf: Date
  /** What the CSV files literally contain, before the primary key is applied. */
  csv: {
    productRows: number
    distinctSkus: number
    poolRows: number
    distinctPoolSkus: number
    rawVendorPrefixes: number
    vendorCodes: number
    collections: number
    /** What should reach Postgres once damaged stock is set aside. */
    loadableSkus: number
    loadablePool: number
    loadableCollections: number
  }
  /** What is actually in Postgres afterwards. */
  loaded: {
    vendors: number
    products: number
    reorderPool: number
    soldOut: number
    lastPiece: number
    collections: number
  }
  anomalies: {
    duplicateSkus: { sku: string; keptTitle: string; droppedTitle: string }[]
    damagedGoods: { sku: string; qty: number; title: string }[]
    vendorPrefixesNormalised: { raw: string; code: string }[]
    vendorPrefixesRejected: string[]
    ambiguousVendorNames: { code: string; chosen: string; rejected: string[] }[]
    poolSkusMissingFromProducts: string[]
    poolReasonMismatches: number
    negativeQty: number
    blankImageUrls: number
    /** Damaged pieces that also carry an ordinary vendor, e.g. HDR-PUR-DMG-49. */
    damagedUnderRealVendor: number
  }
}

/**
 * `DMG` marks damage, not a weaver.
 *
 * The evidence is in the SKUs where it is not the prefix: HDR-PUR-DMG-49 is a
 * damaged HDR piece, with DMG sitting where the fabric code belongs. Where DMG
 * — or the stray 'Saree - 151' form — leads the SKU there is no vendor at all;
 * these are damaged sarees sold off at a reduced price. They are set aside and
 * reported, never turned into a vendor row, because a weaver who does not exist
 * cannot be sent an order.
 */
const DAMAGE_MARKERS = new Set(['DMG', 'SAREE'])

/**
 * The vendor, derived from the SKU. Upper-cased and trimmed because two
 * prefixes in the export carry trailing whitespace; without this, 'DMG ' and
 * 'DMG' would become two weavers who are in fact one.
 */
export function vendorCodeFromSku(sku: string): string {
  return sku.split('-')[0].trim().toUpperCase()
}

/**
 * The vendor a SKU actually names, or null when it names none.
 *
 * `vendorCodeFromSku` above takes segment one unconditionally, which is only a
 * PREFIX when there is something after it. Given `VINTWB14700` — no hyphen at
 * all — segment one is the whole SKU, and the first full sync duly created a
 * weaver named after a stock number, a hundred times over. See migration 026.
 *
 * Two conditions, both necessary:
 *
 *   * the SKU must contain a hyphen, so that segment one is a prefix and not
 *     the entire string;
 *   * that segment must satisfy the vendor code pattern, which is the same
 *     CHECK the `vendors` table enforces — a 40-character segment is not a
 *     weaver either, and finding that out here beats finding out on insert.
 *
 * Null is not a failure and callers must not skip the row: it means the product
 * is real and its weaver is unknown, which is a thing to be assigned rather
 * than a thing to be dropped.
 */
export function derivableVendorCode(sku: string): string | null {
  if (!sku.includes('-')) return null

  const code = vendorCodeFromSku(sku)
  return VENDOR_CODE.test(code) ? code : null
}

/** The three attribute codes a SKU carries, or nulls when it does not. */
export interface SkuSegments {
  collection: string | null
  fabric: string | null
  colour: string | null
}

/**
 * Reads `VENDOR-COLLECTION-FABRIC-COLOUR-SEQ`.
 *
 * Deliberately all-or-nothing: unless there are exactly five non-empty
 * segments, every attribute comes back null and the caller keeps whatever it
 * already had. The seed data contains `DMG - 157` — two segments, spaces around
 * the hyphen, stored verbatim because a weaver copies that string onto a fabric
 * label by hand. Guessing that its second segment is a collection would invent
 * a vocabulary entry out of a stock number.
 *
 * Positional parsing is only safe because no segment may itself contain a
 * hyphen; `vendors.code` permits one, but a code that used it would already
 * have broken `vendorCodeFromSku` above, which has been splitting on the same
 * character since the seed loader was written.
 */
export function parseSkuSegments(sku: string): SkuSegments {
  const none: SkuSegments = { collection: null, fabric: null, colour: null }

  const parts = sku.split('-').map((p) => p.trim().toUpperCase())
  if (parts.length !== 5 || parts.some((p) => p === '')) return none

  return { collection: parts[1], fabric: parts[2], colour: parts[3] }
}

/** Mirrors the CHECK constraint on vendors.code. */
const VENDOR_CODE = /^[A-Z0-9][A-Z0-9_-]{1,15}$/

/**
 * Why a design is in the reorder pool, or null if it is not.
 *
 * The single definition, used by the loader and by /reorder. Verified against
 * the supplied pool file: 7,795 rows at zero, 1,108 at one, and nothing else —
 * negative quantities (oversold pieces) are deliberately outside the pool,
 * exactly as the export has them.
 */
export function reorderReason(qtyAvailable: number): 'sold_out' | 'last_piece' | null {
  if (qtyAvailable === 0) return 'sold_out'
  if (qtyAvailable === 1) return 'last_piece'
  return null
}

function text(value: string | undefined): string | null {
  const trimmed = (value ?? '').trim()
  return trimmed === '' ? null : trimmed
}

function int(value: string | undefined): number | null {
  const trimmed = (value ?? '').trim()
  if (trimmed === '') return null
  const n = Number(trimmed)
  // `seq` arrives from pandas as '15549.0'.
  return Number.isFinite(n) ? Math.trunc(n) : null
}

function decimal(value: string | undefined): string | null {
  const trimmed = (value ?? '').trim()
  if (trimmed === '') return null
  return Number.isFinite(Number(trimmed)) ? trimmed : null
}

interface ProductRow {
  sku: string
  vendorCode: string
  collection: string | null
  fabric: string | null
  colourCode: string | null
  seq: number | null
  title: string | null
  description: string | null
  imageUrl: string | null
  price: string | null
  cost: string | null
  qty: number
  shopifyStatus: string | null
  productType: string | null
}

export async function loadSeed(db: Queryable, opts: LoadOptions): Promise<LoadReport> {
  const say = opts.onProgress ?? (() => {})

  const stockAsOf = opts.stockAsOf ?? (await stat(opts.productsCsvPath)).mtime

  say(`Reading ${opts.productsCsvPath}`)
  const productCsv = parseCsv(await readFile(opts.productsCsvPath, 'utf8'))
  say(`Reading ${opts.poolCsvPath}`)
  const poolCsv = parseCsv(await readFile(opts.poolCsvPath, 'utf8'))

  const anomalies: LoadReport['anomalies'] = {
    duplicateSkus: [],
    damagedGoods: [],
    vendorPrefixesNormalised: [],
    vendorPrefixesRejected: [],
    ambiguousVendorNames: [],
    poolSkusMissingFromProducts: [],
    poolReasonMismatches: 0,
    negativeQty: 0,
    blankImageUrls: 0,
    damagedUnderRealVendor: 0,
  }

  // --- Rows, keyed on the primary key ----------------------------------------
  // `sku` is the primary key because a SKU is a design.
  const bySku = new Map<string, ProductRow>()
  const damagedSkus = new Set<string>()
  const rawPrefixes = new Set<string>()
  const namesByCode = new Map<string, Map<string, number>>()

  for (const r of productCsv) {
    const sku = (r.sku ?? '').trim()
    if (sku === '') continue

    rawPrefixes.add(r.sku.split('-')[0])

    const code = vendorCodeFromSku(sku)
    const qty = int(r.qty) ?? 0

    if (qty < 0) anomalies.negativeQty += 1
    if (text(r.image_url) === null) anomalies.blankImageUrls += 1

    // Damaged stock. Not a weaver, so not a vendor and not a product anyone can
    // be asked to make again.
    if (DAMAGE_MARKERS.has(code)) {
      if (!damagedSkus.has(sku)) {
        damagedSkus.add(sku)
        anomalies.damagedGoods.push({ sku, qty, title: text(r.title) ?? '(no title)' })
      }
      continue
    }

    if (sku.split('-').slice(1).some((seg) => DAMAGE_MARKERS.has(seg.trim().toUpperCase()))) {
      // Damaged, but it belongs to a real weaver and carries a real photograph.
      // Loaded normally; counted here so the number is visible.
      anomalies.damagedUnderRealVendor += 1
    }

    const existing = bySku.get(sku)
    if (existing) {
      anomalies.duplicateSkus.push({
        sku,
        keptTitle: existing.title ?? '(no title)',
        droppedTitle: text(r.title) ?? '(no title)',
      })
      continue
    }

    const counts = namesByCode.get(code) ?? new Map<string, number>()
    const name = text(r.vendor_name)
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1)
    namesByCode.set(code, counts)

    bySku.set(sku, {
      sku,
      vendorCode: code,
      collection: text(r.collection),
      fabric: text(r.fabric),
      colourCode: text(r.colour_code),
      seq: int(r.seq),
      title: text(r.title),
      description: text(r.description),
      imageUrl: text(r.image_url),
      price: decimal(r.price),
      cost: decimal(r.cost),
      qty,
      shopifyStatus: text(r.shopify_status),
      productType: text(r.product_type),
    })
  }

  for (const raw of rawPrefixes) {
    const code = raw.trim().toUpperCase()
    if (raw !== code) anomalies.vendorPrefixesNormalised.push({ raw, code })
  }

  // Stop here. Writing half a load and then reporting the collision would leave
  // a database that looks complete and is not.
  if (anomalies.duplicateSkus.length > 0 && !opts.allowDuplicateSkus) {
    throw new DuplicateSkuError(anomalies.duplicateSkus)
  }

  // --- Vendors, from the distinct prefixes -----------------------------------
  // The display name is chosen, not trusted: prefer a name that matches the
  // code, otherwise the most frequent, otherwise the code itself. Whichever
  // way it goes, the code is what identifies the weaver.
  const vendors: { code: string; displayName: string }[] = []

  for (const [code, counts] of [...namesByCode].sort(([a], [b]) => a.localeCompare(b))) {
    if (!VENDOR_CODE.test(code)) {
      anomalies.vendorPrefixesRejected.push(code)
      continue
    }

    const ranked = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    const matchesCode = ranked.find(([name]) => name.trim().toUpperCase() === code)
    const chosen = (matchesCode ?? ranked[0])?.[0] ?? code

    if (ranked.length > 1) {
      anomalies.ambiguousVendorNames.push({
        code,
        chosen,
        rejected: ranked.map(([n]) => n).filter((n) => n !== chosen),
      })
    }

    vendors.push({ code, displayName: chosen })
  }

  const usableProducts = [...bySku.values()].filter((p) => VENDOR_CODE.test(p.vendorCode))

  // --- Write -----------------------------------------------------------------
  await db.query('begin')
  try {
    say(`Upserting ${vendors.length} vendors`)
    await db.query(
      `insert into vendors (code, display_name)
       select * from unnest($1::text[], $2::text[])
       on conflict (code) where deleted_at is null
       do update set display_name = excluded.display_name`,
      [vendors.map((v) => v.code), vendors.map((v) => v.displayName)],
    )

    const { rows: vendorRows } = await db.query('select id, code from vendors')
    const vendorId = new Map(vendorRows.map((r) => [r.code as string, r.id as string]))

    say(`Upserting ${usableProducts.length} products`)
    // One statement via unnest rather than 9,838 round trips. Chunked so the
    // parameter arrays stay a sane size for the wire protocol.
    const CHUNK = 2000
    for (let i = 0; i < usableProducts.length; i += CHUNK) {
      const chunk = usableProducts.slice(i, i + CHUNK)
      await db.query(
        `insert into products (
           sku, vendor_id, collection, fabric, colour_code, seq,
           title, description, image_url, price, cost,
           product_type, shopify_status, qty_available, stock_synced_at
         )
         select * from unnest(
           $1::text[], $2::uuid[], $3::text[], $4::text[], $5::text[], $6::integer[],
           $7::text[], $8::text[], $9::text[], $10::numeric[], $11::numeric[],
           $12::text[], $13::text[], $14::integer[], $15::timestamptz[]
         )
         on conflict (sku) do update set
           vendor_id       = excluded.vendor_id,
           collection      = excluded.collection,
           fabric          = excluded.fabric,
           colour_code     = excluded.colour_code,
           seq             = excluded.seq,
           title           = excluded.title,
           description     = excluded.description,
           image_url       = excluded.image_url,
           price           = excluded.price,
           cost            = excluded.cost,
           product_type    = excluded.product_type,
           shopify_status  = excluded.shopify_status,
           qty_available   = excluded.qty_available,
           stock_synced_at = excluded.stock_synced_at,
           updated_at      = now()`,
        [
          chunk.map((p) => p.sku),
          chunk.map((p) => vendorId.get(p.vendorCode)),
          chunk.map((p) => p.collection),
          chunk.map((p) => p.fabric),
          chunk.map((p) => p.colourCode),
          chunk.map((p) => p.seq),
          chunk.map((p) => p.title),
          chunk.map((p) => p.description),
          chunk.map((p) => p.imageUrl),
          chunk.map((p) => p.price),
          chunk.map((p) => p.cost),
          chunk.map((p) => p.productType),
          chunk.map((p) => p.shopifyStatus),
          chunk.map((p) => p.qty),
          chunk.map(() => stockAsOf),
        ],
      )
    }

    await db.query('commit')
  } catch (err) {
    await db.query('rollback')
    throw err
  }

  // --- Reconcile against the supplied reorder pool ---------------------------
  // The pool is not stored as a table; it is the predicate `qty_available in
  // (0, 1)`. This proves that predicate reproduces the file we were given,
  // rather than assuming it.
  const poolSkus = new Set<string>()
  for (const r of poolCsv) {
    const sku = (r.sku ?? '').trim()
    if (sku === '') continue
    poolSkus.add(sku)

    // Set aside above, so its absence from `products` is expected.
    if (damagedSkus.has(sku)) continue

    const product = bySku.get(sku)
    if (!product) {
      anomalies.poolSkusMissingFromProducts.push(sku)
      continue
    }
    if (reorderReason(product.qty) !== (r.reorder_reason ?? '').trim()) {
      anomalies.poolReasonMismatches += 1
    }
  }

  const scalar = async (sql: string): Promise<number> => {
    const { rows } = await db.query(sql)
    return Number(Object.values(rows[0])[0])
  }

  const report: LoadReport = {
    stockAsOf,
    csv: {
      productRows: productCsv.length,
      distinctSkus: bySku.size,
      poolRows: poolCsv.length,
      distinctPoolSkus: poolSkus.size,
      rawVendorPrefixes: rawPrefixes.size,
      vendorCodes: vendors.length,
      collections: new Set(
        productCsv.map((r) => (r.collection ?? '').trim()).filter((c) => c !== ''),
      ).size,
      loadableSkus: usableProducts.length,
      loadablePool: usableProducts.filter((p) => reorderReason(p.qty) !== null).length,
      // Eleven of the 43 "collections" in the export are the damaged pieces'
      // own numbers (1032, 159, 151 …). They leave with the damaged stock.
      loadableCollections: new Set(
        usableProducts.map((p) => p.collection).filter((c): c is string => c !== null),
      ).size,
    },
    loaded: {
      vendors: await scalar('select count(*) from vendors'),
      products: await scalar('select count(*) from products'),
      reorderPool: await scalar('select count(*) from products where qty_available in (0, 1)'),
      soldOut: await scalar('select count(*) from products where qty_available = 0'),
      lastPiece: await scalar('select count(*) from products where qty_available = 1'),
      collections: await scalar('select count(distinct collection) from products'),
    },
    anomalies,
  }

  say('Done')
  return report
}
