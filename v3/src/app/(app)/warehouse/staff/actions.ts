'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireStaffRecorder } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { isIsoDate, todayInWarehouse } from '@/lib/performance/period'

/**
 * The staff sheet's writes. Three of them: save the whole day, add a person,
 * change whether a person is active.
 *
 * Every one goes through the ordinary RLS-scoped client, and the save goes
 * through `save_staff_sheet`, which is SECURITY INVOKER — so the edit window
 * and the role check are the database's, not this file's. The guard at the top
 * of each action exists to turn a refusal into a sentence, and (through
 * requireUser) to refuse all writes while a developer is viewing as somebody.
 */

export type SaveResult = { ok: true; saved: number } | { ok: false; message: string }

const attendance = z.enum(['present', 'half_day', 'absent', 'leave'])

const entrySchema = z.object({
  staff_id: z.uuid(),
  attendance: attendance.nullable(),
  note: z.string().max(280).nullable(),
  counts: z.record(z.string().regex(/^[a-z][a-z0-9_]{0,31}$/), z.number().int().min(0).max(100000).nullable()),
  add_flags: z
    .array(
      z.object({
        kind: z.enum(['wrong_item', 'damage', 'repack', 'other']),
        order_ref: z.string().max(60).nullable(),
        note: z.string().max(280).nullable(),
      }),
    )
    .max(20),
  remove_flag_ids: z.array(z.uuid()).max(50),
})

const sheetSchema = z.object({
  date: z.string().refine(isIsoDate, 'Not a date.'),
  entries: z.array(entrySchema).max(200),
})

export type SheetInput = z.infer<typeof sheetSchema>

/** Postgres' wording for an RLS refusal is not a sentence a manager can act on. */
function readable(message: string): string {
  if (/row-level security/i.test(message)) {
    return 'This day can no longer be changed from your account. Ask a founder to correct it.'
  }
  return message
}

export async function saveStaffSheet(input: SheetInput): Promise<SaveResult> {
  await requireStaffRecorder()

  const parsed = sheetSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: 'Some of the sheet could not be read. Check the numbers and try again.' }
  }
  const { date, entries } = parsed.data

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('save_staff_sheet', {
    p_work_date: date,
    p_entries: entries,
  })

  if (error) return { ok: false, message: readable(error.message) }

  revalidatePath('/warehouse/staff')
  revalidatePath('/warehouse')
  revalidatePath('/admin/performance', 'layout')
  return { ok: true, saved: Number(data ?? 0) }
}

export interface RosterState {
  status: 'idle' | 'ok' | 'error'
  message?: string
}

export async function addStaffMember(_prev: RosterState, formData: FormData): Promise<RosterState> {
  const user = await requireStaffRecorder()
  const name = String(formData.get('name') ?? '').trim().replace(/\s+/g, ' ')
  const startedOn = String(formData.get('started_on') ?? '')
  const today = todayInWarehouse()

  if (name.length < 1 || name.length > 60) {
    return { status: 'error', message: 'A name between 1 and 60 characters.' }
  }
  if (startedOn && (!isIsoDate(startedOn) || startedOn > today)) {
    return { status: 'error', message: 'The start date must be today or earlier.' }
  }

  const supabase = await createClient()
  const { error } = await supabase.from('floor_staff').insert({
    display_name: name,
    started_on: startedOn || today,
    created_by: user.id,
  })

  if (error) {
    if (error.code === '23505') {
      return { status: 'error', message: `Someone on the roster is already called “${name}”. Add something to tell them apart.` }
    }
    return { status: 'error', message: readable(error.message) }
  }

  revalidatePath('/warehouse/staff')
  revalidatePath('/admin/performance', 'layout')
  return { status: 'ok', message: `${name} added to the sheet.` }
}

/**
 * Deactivate or bring back. Never delete: a person's days reference them, and
 * the review of a month they worked must still name them.
 *
 * Deactivation is dated today, and from that day on they are not expected on
 * the sheet — so a leaver stops producing gaps without their history going.
 */
export async function setStaffActive(_prev: RosterState, formData: FormData): Promise<RosterState> {
  await requireStaffRecorder()
  const id = String(formData.get('id') ?? '')
  const active = formData.get('active') === 'true'
  if (!z.uuid().safeParse(id).success) return { status: 'error', message: 'No such person.' }

  const supabase = await createClient()
  const { data: person } = await supabase
    .from('floor_staff')
    .select('display_name, started_on')
    .eq('id', id)
    .maybeSingle()
  if (!person) return { status: 'error', message: 'No such person.' }

  const today = todayInWarehouse()
  // Someone added with a start date of today and removed the same day is a
  // typo being undone; the check constraint needs the leaving date on or after
  // the start date, which today always is unless a future start was typed.
  const deactivatedOn = person.started_on > today ? person.started_on : today

  const { error } = await supabase
    .from('floor_staff')
    .update(active ? { active: true, deactivated_on: null } : { active: false, deactivated_on: deactivatedOn })
    .eq('id', id)

  if (error) {
    if (error.code === '23505') {
      return { status: 'error', message: `Someone active is already called “${person.display_name}”.` }
    }
    return { status: 'error', message: readable(error.message) }
  }

  revalidatePath('/warehouse/staff')
  revalidatePath('/admin/performance', 'layout')
  return {
    status: 'ok',
    message: active ? `${person.display_name} is back on the sheet.` : `${person.display_name} is off the sheet from today.`,
  }
}
