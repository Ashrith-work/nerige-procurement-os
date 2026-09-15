/**
 * The SKU of a new saree, and the codes it is built from.
 *
 * The database mints the SKU (`app.compose_intake_sku`, migration 035) in the
 * same statement that allocates the Unique Code, so nothing in the application
 * ever writes one. This twin exists so a screen can PREVIEW the shape before
 * submission — "PGW-BRHM-SLK-CRM-·····" — and so the rule is pinned by a unit
 * test in a language the next person will read first.
 */

/** The `master_data.code` CHECK from migration 022. */
export const CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{0,15}$/

export function isValidCode(code: string): boolean {
  return CODE_PATTERN.test(code)
}

export interface SkuParts {
  vendorCode: string
  collectionCode: string
  fabricCode: string
  colourCode: string
  uniqueCode: number | bigint | string
}

/**
 * `VENDOR-COLLECTION-FABRIC-COLOUR-UNIQUECODE`. The last segment is the Unique
 * Code itself — the number written on the fabric — not a per-collection
 * sequence.
 */
export function composeSku(parts: SkuParts, separator = '-'): string {
  const sep = separator === '' ? '-' : separator
  return [parts.vendorCode, parts.collectionCode, parts.fabricCode, parts.colourCode, String(parts.uniqueCode)].join(sep)
}

/** The shape before a code exists, for the form preview. */
export function previewSku(parts: Omit<SkuParts, 'uniqueCode'>, separator = '-'): string {
  const blank = (s: string) => (s && s !== '?' ? s : '···')
  return composeSku(
    {
      vendorCode: blank(parts.vendorCode),
      collectionCode: blank(parts.collectionCode),
      fabricCode: blank(parts.fabricCode),
      colourCode: blank(parts.colourCode),
      uniqueCode: '#####',
    },
    separator,
  )
}

/**
 * A code for a value that has no SKU position — pattern, border, pallu,
 * product type — derived from its label when the admin leaves the code blank.
 *
 * PRODUCT-MASTER.md's rule: alphanumeric, four characters. Consonants are
 * preferred after the first letter because "TMPL" identifies "Temple" better
 * than "TEMP" does and collides less. Uniqueness is the database's job (the
 * primary key); a collision comes back as an error asking for an explicit code.
 */
export function deriveCode(label: string, length = 4): string {
  const letters = label.toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (letters.length <= length) return letters
  const first = letters[0]
  const consonants = letters.slice(1).replace(/[AEIOU]/g, '')
  const pool = first + consonants
  return (pool.length >= length ? pool : letters).slice(0, length)
}
