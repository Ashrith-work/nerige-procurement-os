'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/session'
import { deriveCode, isValidCode } from '@/lib/intake/sku'

export interface MasterDataState {
  status: 'idle' | 'saved' | 'error'
  message?: string
  /** `type:code` of the row that acted, so only that row shows the result. */
  target?: string
}

const TYPES = ['collection', 'fabric', 'colour', 'product_type', 'pattern', 'border', 'pallu'] as const
type VocabType = (typeof TYPES)[number]
const SKU_TYPES: readonly VocabType[] = ['collection', 'fabric', 'colour']

const isType = (v: string): v is VocabType => (TYPES as readonly string[]).includes(v)

/**
 * The vocabulary, written by its owner.
 *
 * Every write here is a direct update under `master_data_admin_write`
 * (migration 022), which admits the admin and nobody else — `requireAdmin()` is
 * the readable refusal, the policy is the guarantee. There is no RPC because
 * there is no rule to hold beyond the table's own constraints: a named row needs
 * a label, two named rows of a type cannot share one, and a code is the SKU
 * fragment it was discovered as and is never renamed.
 */
function friendly(message: string, code: string | undefined, type: string): string {
  if (code === '23505') {
    return message.includes('value_uniq')
      ? `Another ${type.replace('_', ' ')} already has that name. Two options with one name would be indistinguishable at intake.`
      : `That code already exists for ${type.replace('_', ' ')}.`
  }
  return message
}

const target = (type: string, code: string) => `${type}:${code}`

/** Gives a code its label and makes it selectable at intake. Also renames. */
export async function nameCode(_prev: MasterDataState, formData: FormData): Promise<MasterDataState> {
  await requireAdmin()
  const type = String(formData.get('type') ?? '')
  const code = String(formData.get('code') ?? '')
  const value = String(formData.get('value') ?? '').trim().replace(/\s+/g, ' ')
  const t = target(type, code)

  if (!isType(type) || !code) return { status: 'error', message: 'No code given.', target: t }
  if (value.length < 1 || value.length > 120) return { status: 'error', message: 'Enter a name up to 120 characters.', target: t }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('master_data')
    .update({ value, status: 'named' })
    .eq('type', type)
    .eq('code', code)
    .select('code')

  if (error) return { status: 'error', message: friendly(error.message, error.code, type), target: t }
  if (!data?.length) return { status: 'error', message: 'That code no longer exists.', target: t }

  revalidatePath('/admin/master-data')
  revalidatePath('/intake/new')
  return { status: 'saved', message: `${code} is “${value}”.`, target: t }
}

/**
 * Ignored: never to be offered (a typo, a dead code, `XX`). Un-ignoring returns
 * a code to named if it has a label, otherwise to the naming queue.
 */
export async function setIgnored(_prev: MasterDataState, formData: FormData): Promise<MasterDataState> {
  await requireAdmin()
  const type = String(formData.get('type') ?? '')
  const code = String(formData.get('code') ?? '')
  const ignore = formData.get('ignore') === 'true'
  const hasValue = formData.get('has_value') === 'true'
  const t = target(type, code)
  if (!isType(type) || !code) return { status: 'error', message: 'No code given.', target: t }

  const supabase = await createClient()
  const { error } = await supabase
    .from('master_data')
    .update({ status: ignore ? 'ignored' : hasValue ? 'named' : 'unnamed' })
    .eq('type', type)
    .eq('code', code)

  if (error) return { status: 'error', message: friendly(error.message, error.code, type), target: t }
  revalidatePath('/admin/master-data')
  revalidatePath('/intake/new')
  return { status: 'saved', message: ignore ? `${code} ignored.` : `${code} restored.`, target: t }
}

/**
 * Retire or restore. A retired value stops being offered at intake; every SKU
 * already carrying it keeps resolving, and sarees mid-shoot are not frozen by it
 * (migration 035 narrows the vocabulary trigger for exactly that).
 */
export async function setActive(_prev: MasterDataState, formData: FormData): Promise<MasterDataState> {
  await requireAdmin()
  const type = String(formData.get('type') ?? '')
  const code = String(formData.get('code') ?? '')
  const active = formData.get('active') === 'true'
  const t = target(type, code)
  if (!isType(type) || !code) return { status: 'error', message: 'No code given.', target: t }

  const supabase = await createClient()
  const { error } = await supabase.from('master_data').update({ active }).eq('type', type).eq('code', code)
  if (error) return { status: 'error', message: error.message, target: t }

  revalidatePath('/admin/master-data')
  revalidatePath('/intake/new')
  return { status: 'saved', message: active ? `${code} restored.` : `${code} retired.`, target: t }
}

/**
 * Adds a value by hand: the four types a SKU never carries, and a new
 * collection, fabric or colour that intake needs before the catalogue has one.
 *
 * For the three SKU types the code is REQUIRED — it becomes part of every SKU
 * minted with it, and a derived guess would be printed on fabric. For the other
 * four a blank code is derived from the name.
 */
export async function addValue(_prev: MasterDataState, formData: FormData): Promise<MasterDataState> {
  await requireAdmin()
  const type = String(formData.get('type') ?? '')
  const value = String(formData.get('value') ?? '').trim().replace(/\s+/g, ' ')
  let code = String(formData.get('code') ?? '').trim().toUpperCase()
  const t = `add:${type}`

  if (!isType(type)) return { status: 'error', message: 'Choose a type.', target: t }
  if (value.length < 1 || value.length > 120) return { status: 'error', message: 'Enter a name up to 120 characters.', target: t }

  if (!code) {
    if (SKU_TYPES.includes(type)) {
      return { status: 'error', message: 'A collection, fabric or colour needs its SKU code typed in — it goes onto the fabric.', target: t }
    }
    code = deriveCode(value)
  }
  if (!isValidCode(code)) {
    return { status: 'error', message: 'A code is 1–16 capital letters, digits, "-" or "_", starting with a letter or digit.', target: t }
  }

  const supabase = await createClient()
  const { error } = await supabase.from('master_data').insert({ type, code, value, status: 'named' })
  if (error) return { status: 'error', message: friendly(error.message, error.code, type), target: t }

  revalidatePath('/admin/master-data')
  revalidatePath('/intake/new')
  return { status: 'saved', message: `Added “${value}” (${code}).`, target: t }
}
