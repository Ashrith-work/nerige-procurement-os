/**
 * What "accounted for" means at the receiving bench.
 *
 * Pure, and the application twin of `app.order_is_accounted_for()` in migration
 * 20260915000500. The database is the rule; this exists so the screen can say
 * "this parcel completes the order" BEFORE the button is pressed, rather than
 * the warehouse manager finding out from a status badge afterwards. If the two
 * ever disagree the database wins, and `tests/inwarding.test.ts` runs the same
 * cases against both so that they do not.
 *
 * The rules, stated once:
 *
 *   * A line is accounted for when received + rejected, summed over every
 *     parcel, reaches what was ordered. A rejected piece DID arrive: it is
 *     counted. Whether the weaver owes a replacement is a new order.
 *   * Over-delivery is recorded as it happened, never clamped. Seven pieces in a
 *     box for an order of six is a fact the weaver will be paid against.
 *   * An order is received when it has at least one parcel and every line is
 *     accounted for — or when the bench has closed it short, with a reason.
 */

export type RejectReason = 'damaged' | 'wrong_design' | 'weaving_error' | 'other'

export const REJECT_REASONS: readonly { value: RejectReason; label: string }[] = [
  { value: 'damaged', label: 'Damaged' },
  { value: 'wrong_design', label: 'Wrong design' },
  { value: 'weaving_error', label: 'Weaving error' },
  { value: 'other', label: 'Other' },
]

export function isRejectReason(value: unknown): value is RejectReason {
  return REJECT_REASONS.some((r) => r.value === value)
}

export interface LineTally {
  /** What the order asked for. */
  ordered: number
  /** Good pieces, summed over every parcel so far. */
  received: number
  /** Pieces that arrived and were turned away, summed over every parcel. */
  rejected: number
}

/** Pieces still expected on a line. Never negative: an over-delivery owes nothing. */
export function outstanding(line: LineTally): number {
  return Math.max(0, line.ordered - line.received - line.rejected)
}

export function isLineAccountedFor(line: LineTally): boolean {
  return outstanding(line) === 0
}

export type Completion = 'not_started' | 'partial' | 'complete'

/**
 * Where an order stands, from its lines.
 *
 * `hasParcel` is separate from the tallies because a closed-short parcel can
 * carry no lines at all, and because an order with no parcel is "not started"
 * even in the degenerate case of lines whose ordered quantity is already met.
 */
export function orderCompletion(
  lines: readonly LineTally[],
  opts: { hasParcel: boolean; closedShort?: boolean },
): Completion {
  if (!opts.hasParcel) return 'not_started'
  if (opts.closedShort) return 'complete'
  return lines.every(isLineAccountedFor) ? 'complete' : 'partial'
}

/** One line as typed into the receiving form. */
export interface ReceiptEntry {
  orderLineId: string
  received: number
  rejected: number
  reason: RejectReason | null
  note: string | null
}

export interface ReceiptProblem {
  /** Null for a problem with the parcel as a whole. */
  orderLineId: string | null
  message: string
}

/**
 * What the database will refuse, said before it has to.
 *
 * Mirrors the checks in `public.record_order_receipt()`. Returns every problem
 * rather than the first, because a warehouse manager at a tablet with twelve
 * lines should see all three mistakes at once, not fix them one round trip at a
 * time.
 */
export function validateReceipt(
  entries: readonly ReceiptEntry[],
  opts: { closeShort: boolean; note: string | null },
): ReceiptProblem[] {
  const problems: ReceiptProblem[] = []

  for (const e of entries) {
    if (!Number.isInteger(e.received) || !Number.isInteger(e.rejected)) {
      problems.push({ orderLineId: e.orderLineId, message: 'Use whole pieces.' })
      continue
    }
    if (e.received < 0 || e.rejected < 0) {
      problems.push({ orderLineId: e.orderLineId, message: 'Quantities cannot be negative.' })
      continue
    }
    if (e.rejected > 0 && !e.reason) {
      problems.push({ orderLineId: e.orderLineId, message: 'Say why pieces were rejected.' })
    }
  }

  const anything = entries.some((e) => e.received > 0 || e.rejected > 0)
  if (!anything && !opts.closeShort) {
    problems.push({
      orderLineId: null,
      message: 'Nothing was entered: record at least one piece received or rejected.',
    })
  }

  if (opts.closeShort && !(opts.note ?? '').trim()) {
    problems.push({
      orderLineId: null,
      message: 'Say why the order is being closed with pieces missing.',
    })
  }

  return problems
}

/**
 * Would recording `entries` on top of `lines` complete the order?
 *
 * Lines are matched by id; an entry for a line not in `lines` is ignored here
 * (the database refuses it). Used by the form to label the submit button.
 */
export function wouldComplete(
  lines: readonly (LineTally & { id: string })[],
  entries: readonly Pick<ReceiptEntry, 'orderLineId' | 'received' | 'rejected'>[],
  closeShort: boolean,
): boolean {
  if (closeShort) return true
  const byLine = new Map<string, { received: number; rejected: number }>()
  for (const e of entries) {
    const prev = byLine.get(e.orderLineId) ?? { received: 0, rejected: 0 }
    byLine.set(e.orderLineId, {
      received: prev.received + Math.max(0, e.received || 0),
      rejected: prev.rejected + Math.max(0, e.rejected || 0),
    })
  }
  const anything = [...byLine.values()].some((v) => v.received + v.rejected > 0)
  if (!anything) return false

  return lines.every((l) => {
    const add = byLine.get(l.id) ?? { received: 0, rejected: 0 }
    return isLineAccountedFor({
      ordered: l.ordered,
      received: l.received + add.received,
      rejected: l.rejected + add.rejected,
    })
  })
}

/**
 * Parses a whole-number field from a form. Blank is zero — the bench leaves
 * most lines empty on a partial parcel — and anything unparseable is NaN so
 * `validateReceipt` reports it rather than silently reading it as zero.
 */
export function parseCount(raw: FormDataEntryValue | null | undefined): number {
  const s = typeof raw === 'string' ? raw.trim() : ''
  if (s === '') return 0
  if (!/^-?\d+$/.test(s)) return Number.NaN
  return Number(s)
}
