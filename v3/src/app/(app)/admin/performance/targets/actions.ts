'use server'

import { revalidatePath } from 'next/cache'
import { requireStaffReview } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'

/**
 * Setting what a good day looks like. Owner only, in the database
 * (`staff_tasks_admin_*` policies) and here.
 *
 * The manager records against these numbers but does not set them: the person
 * whose team is measured is not the person who decides the measure.
 */

export interface TaskState {
  status: 'idle' | 'ok' | 'error'
  message?: string
}

/** Blank means "no target". Anything else must be a positive whole number. */
function parseTarget(raw: FormDataEntryValue | null): { ok: true; value: number | null } | { ok: false } {
  const s = String(raw ?? '').trim()
  if (s === '') return { ok: true, value: null }
  if (!/^\d{1,6}$/.test(s) || Number(s) <= 0) return { ok: false }
  return { ok: true, value: Number(s) }
}

function revalidate() {
  revalidatePath('/admin/performance', 'layout')
  revalidatePath('/warehouse/staff')
}

export async function updateTask(_prev: TaskState, formData: FormData): Promise<TaskState> {
  await requireStaffReview()
  const code = String(formData.get('code') ?? '')
  const label = String(formData.get('label') ?? '').trim()
  const target = parseTarget(formData.get('target_per_day'))
  const sortOrder = Number(formData.get('sort_order') ?? 100)
  const active = formData.get('active') === 'on'

  if (!code) return { status: 'error', message: 'No task given.' }
  if (label.length < 1 || label.length > 40) return { status: 'error', message: 'A label of 1–40 characters.' }
  if (!target.ok) return { status: 'error', message: 'A target is a whole number above zero, or blank for none.' }
  if (!Number.isInteger(sortOrder)) return { status: 'error', message: 'Order is a whole number.' }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('staff_tasks')
    .update({ label, target_per_day: target.value, sort_order: sortOrder, active })
    .eq('code', code)
    .select('code')

  if (error) return { status: 'error', message: error.message }
  if (!data?.length) return { status: 'error', message: 'That task could not be changed from this account.' }

  revalidate()
  return { status: 'ok', message: 'Saved.' }
}

export async function addTask(_prev: TaskState, formData: FormData): Promise<TaskState> {
  await requireStaffReview()
  const label = String(formData.get('label') ?? '').trim()
  const target = parseTarget(formData.get('target_per_day'))

  if (label.length < 1 || label.length > 40) return { status: 'error', message: 'A label of 1–40 characters.' }
  if (!target.ok) return { status: 'error', message: 'A target is a whole number above zero, or blank for none.' }

  // The code is derived, never typed: it is an identifier nobody should have to
  // think about, and it must match the database's pattern.
  const code = label
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^(\d)/, 't_$1')
    .slice(0, 32)
  if (!code) return { status: 'error', message: 'Use at least one letter in the label.' }

  const supabase = await createClient()
  const { data: last } = await supabase
    .from('staff_tasks')
    .select('sort_order')
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { error } = await supabase.from('staff_tasks').insert({
    code,
    label,
    target_per_day: target.value,
    sort_order: ((last?.sort_order as number | undefined) ?? 0) + 10,
  })

  if (error) {
    if (error.code === '23505') return { status: 'error', message: `A task like “${label}” already exists — re-enable it below.` }
    return { status: 'error', message: error.message }
  }

  revalidate()
  return { status: 'ok', message: `${label} added. It appears on the staff sheet from now.` }
}
