/**
 * The intake lifecycle, as the screens read it.
 *
 * Must stay in step with the `intake_status` enum in migration 022. It is a
 * hand-written union for the same reason `AppRole` is: a status added to the
 * database without being added here should be a compile error at every
 * `Record<IntakeStatus, …>` below, not a badge that silently reads "undefined".
 *
 * No imports, no server-only code: the unit tests load this directly.
 */
export const INTAKE_STATUSES = [
  'DRAFT',
  'NEW',
  'VALIDATING',
  'SKU_CREATED',
  'SHOPIFY_CREATED',
  'EASYECOM_CREATED',
  'MAPPING_CHECKED',
  'READY_FOR_SHOOT',
  'SHOOT_PENDING',
  'IMAGES_RECEIVED',
  'READY_FOR_REVIEW',
  'APPROVED',
  'PUBLISHED',
  'REJECTED',
  'ERROR',
] as const

export type IntakeStatus = (typeof INTAKE_STATUSES)[number]

export function isIntakeStatus(value: unknown): value is IntakeStatus {
  return typeof value === 'string' && (INTAKE_STATUSES as readonly string[]).includes(value)
}

/**
 * What each status means to the person looking at it. Written for the
 * warehouse floor, not for the enum: "Shot — photos to record" says what to do
 * next, `SHOOT_PENDING` does not.
 */
export const STATUS_LABELS: Record<IntakeStatus, string> = {
  DRAFT: 'Draft',
  NEW: 'Submitted',
  VALIDATING: 'Validating',
  SKU_CREATED: 'SKU created',
  SHOPIFY_CREATED: 'On Shopify (draft)',
  EASYECOM_CREATED: 'In EasyEcom',
  MAPPING_CHECKED: 'Mapping checked',
  READY_FOR_SHOOT: 'Ready to shoot',
  SHOOT_PENDING: 'Shot — photos to record',
  IMAGES_RECEIVED: 'Photos recorded',
  READY_FOR_REVIEW: 'Waiting for review',
  APPROVED: 'Approved',
  PUBLISHED: 'Published',
  REJECTED: 'Rejected',
  ERROR: 'Error',
}

/**
 * The same colour vocabulary as `StatusBadge` in primitives: amber means
 * somebody is waiting, blue means in motion, green settled, red stopped.
 */
export type Tone = 'neutral' | 'waiting' | 'moving' | 'good' | 'bad'

export const STATUS_TONES: Record<IntakeStatus, Tone> = {
  DRAFT: 'neutral',
  NEW: 'moving',
  VALIDATING: 'moving',
  SKU_CREATED: 'moving',
  SHOPIFY_CREATED: 'moving',
  EASYECOM_CREATED: 'moving',
  MAPPING_CHECKED: 'moving',
  READY_FOR_SHOOT: 'waiting',
  SHOOT_PENDING: 'waiting',
  IMAGES_RECEIVED: 'waiting',
  READY_FOR_REVIEW: 'waiting',
  APPROVED: 'good',
  PUBLISHED: 'good',
  REJECTED: 'bad',
  ERROR: 'bad',
}

/**
 * Stages: the handful of buckets a dashboard counts and the queue filters by.
 * Fourteen statuses cannot be read at a glance; five stages can.
 *
 * The pipeline statuses (NEW … MAPPING_CHECKED) count as "to shoot" because the
 * saree is physically in the warehouse with its code on it whether or not n8n
 * has done its part — and n8n is not wired, so nothing would ever move them
 * otherwise.
 */
export type IntakeStage = 'draft' | 'shoot' | 'upload' | 'review' | 'approved' | 'rejected' | 'error'

export const STAGE_STATUSES: Record<IntakeStage, readonly IntakeStatus[]> = {
  draft: ['DRAFT'],
  shoot: ['NEW', 'VALIDATING', 'SKU_CREATED', 'SHOPIFY_CREATED', 'EASYECOM_CREATED', 'MAPPING_CHECKED', 'READY_FOR_SHOOT'],
  upload: ['SHOOT_PENDING', 'IMAGES_RECEIVED'],
  review: ['READY_FOR_REVIEW'],
  approved: ['APPROVED', 'PUBLISHED'],
  rejected: ['REJECTED'],
  error: ['ERROR'],
}

export const STAGE_LABELS: Record<IntakeStage, string> = {
  draft: 'Drafts',
  shoot: 'To shoot',
  upload: 'Shot, photos pending',
  review: 'Waiting for review',
  approved: 'Approved',
  rejected: 'Rejected',
  error: 'Errors',
}

export function stageOf(status: IntakeStatus): IntakeStage {
  for (const [stage, statuses] of Object.entries(STAGE_STATUSES) as [IntakeStage, readonly IntakeStatus[]][]) {
    if (statuses.includes(status)) return stage
  }
  // Unreachable while every status sits in exactly one stage, which the unit
  // test asserts.
  return 'error'
}

/** A required code a draft is still waiting for. See `save_intake` in migration 035. */
export const MISSING_CODE = '?'
