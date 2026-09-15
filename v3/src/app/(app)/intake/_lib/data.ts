import 'server-only'
import { randomUUID } from 'node:crypto'
import type { createClient } from '@/lib/supabase/server'
import type { IntakeStatus } from '@/lib/intake/status'
import { MISSING_CODE } from '@/lib/intake/status'
import { availableTransitions, type IntakeRole } from '@/lib/intake/transitions'
import type { EdgeOption } from '../_components/transition-controls'

/**
 * The reads every intake screen shares: vendors, pricing settings, vocabulary
 * labels and people's names.
 *
 * Vendors, settings and names come through narrow SECURITY DEFINER functions
 * (migration 035) rather than the tables, because the warehouse manager holds
 * no policy on `vendors`, `app_settings` or `app_users` and should not be given
 * one — each of those tables carries phone numbers or integration
 * configuration that intake has no use for.
 */

type Supabase = Awaited<ReturnType<typeof createClient>>

export interface VendorOption {
  id: string
  code: string
  displayName: string
  status: string
  isPlaceholder: boolean
}

export interface IntakeContext {
  vendors: VendorOption[]
  markupMultiplier: number
  roundingNearest: number
  minImagesForReview: number
  currency: string
  skuSeparator: string
}

export async function loadIntakeContext(supabase: Supabase): Promise<IntakeContext> {
  const { data, error } = await supabase.rpc('intake_form_context')
  if (error || !data) throw new Error(`Could not load intake settings: ${error?.message ?? 'no data'}`)

  const raw = data as {
    vendors: { id: string; code: string; display_name: string; status: string; is_placeholder: boolean }[]
    mrp_markup_multiplier: number | string
    mrp_rounding_nearest: number
    image_min_count_for_review: number
    currency: string
    sku_separator: string
  }

  return {
    vendors: (raw.vendors ?? []).map((v) => ({
      id: v.id,
      code: v.code,
      displayName: v.display_name,
      status: v.status,
      isPlaceholder: v.is_placeholder,
    })),
    markupMultiplier: Number(raw.mrp_markup_multiplier),
    roundingNearest: Number(raw.mrp_rounding_nearest),
    minImagesForReview: Number(raw.image_min_count_for_review),
    currency: raw.currency,
    skuSeparator: raw.sku_separator || '-',
  }
}

export const VOCAB_TYPES = ['collection', 'fabric', 'colour', 'product_type', 'pattern', 'border', 'pallu'] as const
export type VocabType = (typeof VOCAB_TYPES)[number]

/** The three types a SKU carries. The other four reach Shopify, never the SKU. */
export const SKU_VOCAB_TYPES: readonly VocabType[] = ['collection', 'fabric', 'colour']

export const VOCAB_LABELS: Record<VocabType, string> = {
  collection: 'Collection',
  fabric: 'Fabric',
  colour: 'Colour',
  product_type: 'Product type',
  pattern: 'Pattern',
  border: 'Border',
  pallu: 'Pallu',
}

export interface VocabValue {
  type: VocabType
  code: string
  value: string | null
  status: 'unnamed' | 'named' | 'ignored'
  active: boolean
}

export type Vocabulary = Record<VocabType, VocabValue[]>

/** Every master_data row, grouped by type. Staff read it all (migration 022). */
export async function loadVocabulary(supabase: Supabase): Promise<Vocabulary> {
  const { data, error } = await supabase
    .from('master_data')
    .select('type, code, value, status, active')
    .order('value', { ascending: true, nullsFirst: false })
  if (error) throw new Error(`Could not load master data: ${error.message}`)

  const grouped = Object.fromEntries(VOCAB_TYPES.map((t) => [t, [] as VocabValue[]])) as Vocabulary
  for (const row of (data ?? []) as VocabValue[]) grouped[row.type]?.push(row)
  return grouped
}

/** What intake may offer: named and active. The same predicate as the vocabulary trigger. */
export function offered(vocab: Vocabulary, type: VocabType): VocabValue[] {
  return vocab[type].filter((v) => v.status === 'named' && v.active)
}

/** "Vintage (VINT)", or the bare code when nobody has named it, or "missing" for a draft's '?'. */
export function vocabLabel(vocab: Vocabulary, type: VocabType, code: string | null | undefined): string {
  if (!code) return '—'
  if (code === MISSING_CODE) return 'missing'
  const found = vocab[type].find((v) => v.code === code)
  return found?.value ? `${found.value} (${code})` : code
}

/** Names for the people on a timeline. Unknown ids simply do not resolve. */
export async function loadPeople(supabase: Supabase, ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))]
  const names = new Map<string, string>()
  if (unique.length === 0) return names
  const { data } = await supabase.rpc('intake_people', { p_ids: unique })
  for (const p of (data ?? []) as { id: string; full_name: string }[]) names.set(p.id, p.full_name)
  return names
}

/**
 * The idempotency key, generated when the form renders — never typed by a
 * person, so the guarantee does not depend on somebody inventing a unique
 * string (migration 022). A module function rather than a call in the page body,
 * which is where a render-purity lint would rightly object to randomness.
 */
export function newIntakeKey(): string {
  return `intake_${randomUUID()}`
}

/**
 * The workflow buttons this person may press on a saree in `status`, as plain
 * objects a client component can receive.
 */
export function edgesFor(role: IntakeRole, status: IntakeStatus): EdgeOption[] {
  return availableTransitions(role, status).map(({ to, label, requires, variant }) => ({ to, label, requires, variant }))
}

/** The product_intakes columns the list screens read. */
export const INTAKE_LIST_COLUMNS =
  'unique_code, sku, status, vendor_id, collection_code, fabric_code, colour_code, product_type_code, ' +
  'cost_price, mrp, image_count, img_status, approval_status, rejection_reason, approved_by, approved_at, ' +
  'error_status, error_stage, error_message, draft_note, submitted_by, created_at, updated_at, status_history'

export interface IntakeListRow {
  unique_code: number
  sku: string | null
  status: IntakeStatus
  vendor_id: string
  collection_code: string
  fabric_code: string
  colour_code: string
  product_type_code: string
  cost_price: number | string
  mrp: number | string | null
  image_count: number
  img_status: string
  approval_status: string
  rejection_reason: string | null
  approved_by: string | null
  approved_at: string | null
  error_status: boolean
  error_stage: string | null
  error_message: string | null
  draft_note: string | null
  submitted_by: string | null
  created_at: string
  updated_at: string
  status_history: unknown
}
