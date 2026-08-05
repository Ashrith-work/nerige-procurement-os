import type { LoadReport, DuplicateSkuError } from './load'

/**
 * The counts the build brief asks the loader to verify.
 *
 * They are row counts taken from the CSV files. Not all of them can also be row
 * counts in Postgres — `products.sku` is the primary key and two SKUs repeat,
 * and damaged stock is set aside rather than given a vendor — so the report
 * shows every number side by side rather than picking whichever one passes.
 */
export const EXPECTED = {
  productRows: 9840,
  poolRows: 8903,
  vendors: 53,
  collections: 43,
} as const

function line(label: string, expected: number, actual: number): string {
  const mark = expected === actual ? 'ok  ' : 'DIFF'
  const delta = expected === actual ? '' : `  (${actual > expected ? '+' : ''}${actual - expected})`
  return `  ${mark}  ${label.padEnd(34)} expected ${String(expected).padStart(6)}   actual ${String(actual).padStart(6)}${delta}`
}

export function formatDuplicateFailure(err: DuplicateSkuError): string {
  const out: string[] = ['', 'LOAD REFUSED', '']
  out.push(`  ${err.duplicates.length} SKU(s) appear more than once in the export.`)
  out.push('  A SKU is a design and is the primary key, so only one row can survive —')
  out.push('  and either could be the real saree. Nothing was written.')
  out.push('')
  for (const d of err.duplicates) {
    out.push(`    ${d.sku}`)
    out.push(`      "${d.keptTitle}"`)
    out.push(`      "${d.droppedTitle}"`)
  }
  out.push('')
  out.push('  Fix the export, or pass --allow-duplicate-skus to keep the first of each')
  out.push('  for development only.')
  out.push('')
  return out.join('\n')
}

export function formatReport(r: LoadReport): string {
  const out: string[] = []

  out.push('')
  out.push('CSV as supplied')
  out.push(line('product rows', EXPECTED.productRows, r.csv.productRows))
  out.push(line('reorder pool rows', EXPECTED.poolRows, r.csv.poolRows))
  out.push(line('vendor prefixes, raw', EXPECTED.vendors, r.csv.rawVendorPrefixes))
  out.push(line('collections', EXPECTED.collections, r.csv.collections))

  out.push('')
  out.push('Loaded into Postgres')
  out.push(line('products', r.csv.loadableSkus, r.loaded.products))
  out.push(line('reorder pool (qty 0 or 1)', r.csv.loadablePool, r.loaded.reorderPool))
  out.push(line('vendors', r.csv.vendorCodes, r.loaded.vendors))
  out.push(line('collections', r.csv.loadableCollections, r.loaded.collections))
  out.push(`        sold out ${r.loaded.soldOut}, last piece ${r.loaded.lastPiece}`)
  out.push(`        stock_synced_at ${r.stockAsOf.toISOString()}`)

  const a = r.anomalies
  out.push('')
  out.push('Set aside, and why')

  if (a.damagedGoods.length > 0) {
    out.push(`  ${a.damagedGoods.length} damaged saree(s). DMG marks damage, not a weaver — the`)
    out.push('  same marker appears mid-SKU on real vendors (HDR-PUR-DMG-49). Where it')
    out.push('  leads the SKU there is no vendor to send an order to, so these are held')
    out.push('  out of products and no vendor row is created for them:')
    for (const d of a.damagedGoods) {
      out.push(`    ${d.sku.padEnd(16)} qty ${String(d.qty).padStart(2)}   ${d.title}`)
    }
  }

  if (a.damagedUnderRealVendor > 0) {
    out.push(
      `  ${a.damagedUnderRealVendor} damaged piece(s) under a real vendor were loaded normally.`,
    )
  }

  if (a.duplicateSkus.length > 0) {
    out.push(`  ${a.duplicateSkus.length} repeated SKU(s), first kept (--allow-duplicate-skus):`)
    for (const d of a.duplicateSkus) {
      out.push(`    ${d.sku}  kept "${d.keptTitle}"  dropped "${d.droppedTitle}"`)
    }
  }

  if (a.vendorPrefixesNormalised.length > 0) {
    out.push(`  ${a.vendorPrefixesNormalised.length} SKU prefix(es) needed trimming:`)
    for (const v of a.vendorPrefixesNormalised) {
      out.push(`    "${v.raw}" -> ${v.code}`)
    }
  }

  if (a.vendorPrefixesRejected.length > 0) {
    out.push(`  ${a.vendorPrefixesRejected.length} prefix(es) rejected by the vendor code rule:`)
    out.push(`    ${a.vendorPrefixesRejected.join(', ')}`)
  }

  if (a.ambiguousVendorNames.length > 0) {
    out.push(
      `  ${a.ambiguousVendorNames.length} vendor code(s) carry more than one name in the export.`,
    )
    out.push('  The code is the vendor; the name is chosen for display only:')
    for (const v of a.ambiguousVendorNames) {
      out.push(`    ${v.code} -> "${v.chosen}"   also seen: ${v.rejected.join(', ')}`)
    }
  }

  if (a.poolSkusMissingFromProducts.length > 0) {
    out.push(`  ${a.poolSkusMissingFromProducts.length} pool SKU(s) absent from the product file:`)
    out.push(`    ${a.poolSkusMissingFromProducts.slice(0, 10).join(', ')}`)
  }

  out.push('')
  out.push('Noted, loaded as-is')
  out.push(`  reorder_reason disagreeing with qty: ${a.poolReasonMismatches}`)
  out.push(`  rows with negative qty (oversold, outside the pool): ${a.negativeQty}`)
  out.push(`  rows with no image: ${a.blankImageUrls}`)
  out.push('')

  return out.join('\n')
}

/**
 * True when what landed in Postgres is exactly what the CSVs describe.
 *
 * Deliberately not "the four stated counts matched" — two of them cannot, given
 * a primary key on the SKU and damaged stock with no weaver behind it. What
 * must hold is that the pool predicate `qty_available in (0, 1)` reproduces the
 * supplied reorder file, and that nothing went missing without being named.
 */
export function isConsistent(r: LoadReport): boolean {
  return (
    r.anomalies.poolReasonMismatches === 0 &&
    r.anomalies.poolSkusMissingFromProducts.length === 0 &&
    r.anomalies.vendorPrefixesRejected.length === 0 &&
    r.loaded.products === r.csv.loadableSkus &&
    r.loaded.reorderPool === r.csv.loadablePool &&
    r.loaded.vendors === r.csv.vendorCodes &&
    r.loaded.collections === r.csv.loadableCollections
  )
}
