/**
 * The procurement vocabulary, in TypeScript.
 *
 * These types and transition tables MIRROR the database — they do not define
 * it. The state machine is enforced by triggers in
 * `supabase/migrations/20260805000200_purchase_orders.sql` and
 * `…000400_billing.sql`, which is what makes it true for every client. What
 * lives here exists so a screen can render the *right buttons* rather than
 * offering an action the database will refuse a second later.
 *
 * If the two ever disagree, the database wins and this file is the bug.
 */
import type { AppRole } from '@/lib/auth/session'

export type PoStatus =
  | 'draft'
  | 'issued'
  | 'acknowledged'
  | 'in_production'
  | 'dispatched'
  | 'partially_received'
  | 'received'
  | 'closed'
  | 'cancelled'

export type PoLineKind = 'restock' | 'new_design'
export type BillStatus =
  | 'submitted'
  | 'under_review'
  | 'disputed'
  | 'rejected'
  | 'approved'
  | 'paid'
export type ReceiptStatus = 'draft' | 'posted' | 'cancelled'

/** Orders that are still someone's problem. Everything else is history. */
export const OPEN_PO_STATUSES: PoStatus[] = [
  'issued',
  'acknowledged',
  'in_production',
  'dispatched',
  'partially_received',
  'received',
]

/** Orders the warehouse could plausibly receive against today. */
export const RECEIVABLE_PO_STATUSES: PoStatus[] = [
  'issued',
  'acknowledged',
  'in_production',
  'dispatched',
  'partially_received',
]

/**
 * What each status means to the person reading it.
 *
 * The `waitingOn` field is the one that earns its keep: every list in this
 * system is really answering "whose move is it?", and the answer is a property
 * of the status rather than something each screen should re-derive.
 */
export const PO_STATUS_META: Record<
  PoStatus,
  { label: string; waitingOn: 'us' | 'vendor' | 'warehouse' | 'nobody'; hint: string }
> = {
  draft: { label: 'Draft', waitingOn: 'us', hint: 'Not sent. The vendor cannot see this.' },
  issued: { label: 'Sent', waitingOn: 'vendor', hint: 'Waiting for the vendor to accept.' },
  acknowledged: { label: 'Accepted', waitingOn: 'vendor', hint: 'Vendor has accepted the order.' },
  in_production: { label: 'In production', waitingOn: 'vendor', hint: 'Being woven.' },
  dispatched: { label: 'Dispatched', waitingOn: 'warehouse', hint: 'On its way. Count it in on arrival.' },
  partially_received: {
    label: 'Part received',
    waitingOn: 'warehouse',
    hint: 'Some pieces counted in; the rest are still outstanding.',
  },
  received: { label: 'Received', waitingOn: 'us', hint: 'All counted in. Waiting on the bill.' },
  closed: { label: 'Closed', waitingOn: 'nobody', hint: 'Received and settled.' },
  cancelled: { label: 'Cancelled', waitingOn: 'nobody', hint: 'This order will not be fulfilled.' },
}

export const BILL_STATUS_META: Record<BillStatus, { label: string; hint: string }> = {
  submitted: { label: 'Submitted', hint: 'Uploaded. Nobody has checked it yet.' },
  under_review: { label: 'Under review', hint: 'Being matched against what was counted in.' },
  disputed: { label: 'Disputed', hint: 'Raised with the vendor — figures do not agree.' },
  rejected: { label: 'Rejected', hint: 'Will not be paid.' },
  approved: { label: 'Approved', hint: 'Authorised for payment.' },
  paid: { label: 'Paid', hint: 'Settled.' },
}

/**
 * The status moves a vendor may make from the portal.
 *
 * Mirrors the `v_role = 'vendor'` branch of app.po_guard_transition().
 */
export function vendorNextStatuses(status: PoStatus): PoStatus[] {
  switch (status) {
    case 'issued':
      return ['acknowledged']
    case 'acknowledged':
      return ['in_production', 'dispatched']
    case 'in_production':
      return ['dispatched']
    default:
      return []
  }
}

/** Whether this role may build and issue orders. Mirrors app.can_manage_orders(). */
export function canManageOrders(role: AppRole): boolean {
  return role === 'founder' || role === 'procurement_head'
}

/** Whether this role may count stock in. Mirrors app.can_receive_goods(). */
export function canReceiveGoods(role: AppRole): boolean {
  return role === 'founder' || role === 'warehouse_manager' || role === 'procurement_head'
}

/** Whether this role may see and review bills. Mirrors app.can_handle_bills(). */
export function canHandleBills(role: AppRole): boolean {
  return role === 'founder' || role === 'procurement_head'
}

/** Only the Founder releases money. Mirrors the check in app.bill_guard_transition(). */
export function canApproveBills(role: AppRole): boolean {
  return role === 'founder'
}

/**
 * The value of what was actually counted in against an order.
 *
 * The same arithmetic the database performs in `app.bill_prepare()` when it
 * snapshots the three-way match. Repeated here only so a bill form can show the
 * comparison *before* submitting; the authoritative figure is always the stored
 * one, because it is computed where the quantities live.
 *
 * Damaged pieces are excluded, exactly as they are in the trigger — they
 * arrived, but they are not stock and we are not paying for them.
 */
export function receivedValue(
  lines: { quantity_received: number; unit_price: string; gst_rate: string }[],
): number {
  return lines.reduce((sum, l) => {
    const net = l.quantity_received * Number(l.unit_price)
    return sum + net + Math.round(((net * Number(l.gst_rate)) / 100) * 100) / 100
  }, 0)
}

/**
 * A PO line, whichever kind it is, described the way a human would describe it.
 *
 * A restock line is a SKU; a new-design line is a sentence about a saree that
 * does not exist yet. Every screen that lists lines needs both, so the
 * flattening lives here rather than being re-invented per screen.
 */
export interface LineDescriptor {
  heading: string
  sub: string | null
  code: string | null
}

export function describeLine(line: {
  kind: PoLineKind
  description: string | null
  colours: string[] | null
  products?: { sku: string; title: string; colour: string | null } | null
  product_series?: { name: string } | null
}): LineDescriptor {
  if (line.kind === 'restock' && line.products) {
    return {
      heading: line.products.title,
      sub: line.products.colour,
      code: line.products.sku,
    }
  }

  const colours = line.colours?.length ? line.colours.join(', ') : null
  return {
    heading: line.product_series?.name ?? 'New design',
    sub: line.description,
    // No SKU yet, and saying so is the point: the code is assigned when the
    // pieces arrive and we can see what we actually got.
    code: colours ? `Colours: ${colours}` : null,
  }
}
