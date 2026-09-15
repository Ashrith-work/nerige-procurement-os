/**
 * MRP from cost price — the twin of `app.compute_mrp` in migration 035.
 *
 * The database prices the saree; this exists so the form can show the MRP as
 * the cost is typed. They must agree to the rupee, or the warehouse manager is
 * shown one price and Shopify is given another.
 *
 * THE FLOATING-POINT TRAP. The rule rounds UP to the nearest step, and
 * `1200 * 1.6` in JavaScript is `1920.0000000000002`, which rounds up to 1930.
 * So nothing here multiplies floats: the cost becomes whole paise, the
 * multiplier whole thousandths (the column is numeric(6,3)), and the arithmetic
 * is BigInt until the final division.
 */

/** Parses a decimal string or number into an integer scaled by 10^scale, or null. */
function toScaled(value: string | number, scale: number): bigint | null {
  const text = typeof value === 'number' ? (Number.isFinite(value) ? value.toString() : '') : value.trim()
  const match = /^(\d+)(?:\.(\d*))?$/.exec(text)
  if (!match) return null
  const whole = match[1]
  const fraction = (match[2] ?? '').padEnd(scale, '0')
  // More precision than the scale holds is truncated, not rounded: a cost price
  // has paise and a multiplier has three places, and the columns enforce both.
  return BigInt(whole) * BigInt(10) ** BigInt(scale) + BigInt(fraction.slice(0, scale) || '0')
}

/**
 * `ceil(cost × multiplier / step) × step` when step > 1; otherwise
 * `cost × multiplier` to the paisa (half up). Returns rupees as a number, or
 * null when the inputs are not a positive cost and multiplier.
 */
export function computeMrp(
  cost: string | number | null | undefined,
  multiplier: string | number | null | undefined,
  step: number | null | undefined,
): number | null {
  if (cost === null || cost === undefined || multiplier === null || multiplier === undefined) return null
  const paise = toScaled(cost, 2)
  const thousandths = toScaled(multiplier, 3)
  if (paise === null || thousandths === null || paise <= BigInt(0) || thousandths <= BigInt(0)) return null

  // paise × thousandths = rupees × 100 × 1000.
  const raw = paise * thousandths
  const PER_RUPEE = BigInt(100_000)
  const stepRupees = Math.trunc(step ?? 1)

  if (stepRupees > 1) {
    const unit = PER_RUPEE * BigInt(stepRupees)
    const steps = (raw + unit - BigInt(1)) / unit // ceil for positives
    return Number(steps * BigInt(stepRupees))
  }

  // To the paisa, half up: one paisa is 1000 raw units.
  const paisaUnit = BigInt(1000)
  const paiseRounded = (raw + paisaUnit / BigInt(2)) / paisaUnit
  return Number(paiseRounded) / 100
}

export function formatRupees(amount: number | string | null | undefined): string {
  if (amount === null || amount === undefined || amount === '') return '—'
  const n = typeof amount === 'string' ? Number(amount) : amount
  if (!Number.isFinite(n)) return '—'
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
}
