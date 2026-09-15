import type { IntakeStatus } from './status'

/**
 * Who may move a saree, and where — the twin of `transition_intake` in
 * migration 035.
 *
 * The database enforces this table; the screens read it so they offer only the
 * buttons that will work. A button that ends in "you cannot do that" teaches
 * people the screen is wrong, and they stop trusting the ones that are right.
 *
 * Roles are a plain string union here rather than `AppRole` from the session
 * module, which is `server-only` and cannot be loaded by a unit test.
 */
export type IntakeRole =
  | 'admin'
  | 'procurement_head'
  | 'warehouse_manager'
  | 'customer_support'
  | 'vendor'
  | 'developer'

/** Mirrors `app.can_submit_intake()`. */
export function canSubmitIntake(role: IntakeRole): boolean {
  return role === 'admin' || role === 'warehouse_manager'
}

/**
 * Mirrors `app.can_review_intake()`. Excludes the warehouse manager on purpose:
 * the person who submits and shoots a saree is not the person who signs it off.
 */
export function canReviewIntake(role: IntakeRole): boolean {
  return role === 'admin' || role === 'procurement_head'
}

export type Capability = 'submit' | 'review'

export interface TransitionEdge {
  from: readonly IntakeStatus[]
  to: IntakeStatus
  needs: Capability
  /** The button. */
  label: string
  /** What the form must collect before the edge is valid. */
  requires?: 'image_count' | 'reason'
  /** Destructive-looking actions get the secondary style. */
  variant?: 'primary' | 'secondary' | 'danger'
}

/** The table in migration 035's header, row for row. */
export const TRANSITIONS: readonly TransitionEdge[] = [
  { from: ['SKU_CREATED'], to: 'READY_FOR_SHOOT', needs: 'submit', label: 'Send to shoot', variant: 'secondary' },
  { from: ['SKU_CREATED', 'READY_FOR_SHOOT'], to: 'SHOOT_PENDING', needs: 'submit', label: 'Mark shot' },
  {
    from: ['SHOOT_PENDING', 'IMAGES_RECEIVED'],
    to: 'IMAGES_RECEIVED',
    needs: 'submit',
    label: 'Record photos',
    requires: 'image_count',
    variant: 'secondary',
  },
  { from: ['READY_FOR_REVIEW'], to: 'IMAGES_RECEIVED', needs: 'submit', label: 'Take back from review', variant: 'secondary' },
  {
    from: ['SHOOT_PENDING', 'IMAGES_RECEIVED'],
    to: 'READY_FOR_REVIEW',
    needs: 'submit',
    label: 'Send to review',
    requires: 'image_count',
  },
  { from: ['READY_FOR_REVIEW'], to: 'APPROVED', needs: 'review', label: 'Approve' },
  { from: ['READY_FOR_REVIEW'], to: 'REJECTED', needs: 'review', label: 'Reject', requires: 'reason', variant: 'danger' },
  { from: ['REJECTED'], to: 'READY_FOR_SHOOT', needs: 'submit', label: 'Reshoot', variant: 'secondary' },
]

function holds(role: IntakeRole, needs: Capability): boolean {
  return needs === 'submit' ? canSubmitIntake(role) : canReviewIntake(role)
}

/** Whether `role` may move a saree from `from` to `to`. */
export function canTransition(role: IntakeRole, from: IntakeStatus, to: IntakeStatus): boolean {
  return TRANSITIONS.some((t) => t.to === to && t.from.includes(from) && holds(role, t.needs))
}

/** Every move `role` can make from `status`, in table order. */
export function availableTransitions(role: IntakeRole, status: IntakeStatus): TransitionEdge[] {
  return TRANSITIONS.filter((t) => t.from.includes(status) && holds(role, t.needs))
}

/**
 * Whether a saree may be sent to review with this many photographs. The
 * database uses `greatest(1, image_min_count_for_review)`: a saree reviewed with
 * no photographs at all is not a review, whatever the setting says.
 */
export function enoughImagesForReview(count: number, minimumSetting: number): boolean {
  return Number.isInteger(count) && count >= Math.max(1, minimumSetting)
}

/**
 * Whether this person may edit a DRAFT: the owner, or whoever saved it. Mirrors
 * `save_intake`'s own check.
 */
export function canEditDraft(role: IntakeRole, userId: string, submittedBy: string | null): boolean {
  if (role === 'admin') return true
  return role === 'warehouse_manager' && submittedBy === userId
}
