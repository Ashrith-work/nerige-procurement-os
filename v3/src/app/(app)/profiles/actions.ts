'use server'

import { randomUUID } from 'node:crypto'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/auth/session'
import { safeNext } from '@/lib/auth/guards'
import { WORKSPACE_COOKIE } from '@/lib/workspaces.server'
import { availableSections, isCustomKey, TEMPLATES } from '@/lib/workspaces'

/**
 * Everything a person can do to their own workspaces.
 *
 * Every write here is `user_id = auth.uid()` and the policy says the same, so
 * these are the one part of the application where an admin has no more authority
 * than anybody else: how you arrange your own working day is yours.
 *
 * Writes are upserts on (user_id, key) because a template has no row until the
 * first time somebody changes something about it — see migration 038 on why the
 * templates are code and not rows.
 */

async function saveRow(key: string, patch: Record<string, unknown>) {
  const user = await requireStaff()
  const supabase = await createClient()

  const { error } = await supabase
    .from('user_workspaces')
    .upsert({ user_id: user.id, key, ...patch }, { onConflict: 'user_id,key' })

  if (error) throw new Error(`Could not save that: ${error.message}`)
  revalidatePath('/', 'layout')
}

/** Switch to a workspace for this session. */
export async function switchWorkspace(formData: FormData): Promise<void> {
  await requireStaff()
  const key = String(formData.get('key') ?? '')
  const to = String(formData.get('to') ?? '')

  ;(await cookies()).set(WORKSPACE_COOKIE, key, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    // A year: which job you are doing is not a thing to be asked again weekly.
    maxAge: 60 * 60 * 24 * 365,
  })

  revalidatePath('/', 'layout')
  // Straight into the work, not back to a hub. `to` comes from the switcher and
  // is always a section href — but it arrives in a form post, so it is checked
  // like any other supplied destination: same-origin path only, no backslash or
  // control character. See safeNext().
  redirect(safeNext(to, '/dashboard'))
}

/** The one that opens when you sign in. */
export async function makeDefault(formData: FormData): Promise<void> {
  const user = await requireStaff()
  const key = String(formData.get('key') ?? '')
  if (!key) return

  const supabase = await createClient()
  // Clear first: the unique index permits one default per person, and an upsert
  // that set a second would be refused with a constraint error rather than a
  // sentence.
  await supabase.from('user_workspaces').update({ is_default: false }).eq('user_id', user.id)
  await saveRow(key, { is_default: true, hidden: false })
}

/** Hide a workspace you never use, or bring it back. */
export async function setHidden(formData: FormData): Promise<void> {
  const key = String(formData.get('key') ?? '')
  const hidden = String(formData.get('hidden') ?? '') === '1'
  if (!key) return
  await saveRow(key, { hidden, is_default: false })
}

/** Build one of your own, or edit it. */
export async function saveWorkspace(formData: FormData): Promise<void> {
  const user = await requireStaff()
  const existing = String(formData.get('key') ?? '')
  const name = String(formData.get('name') ?? '').trim().slice(0, 40)
  const chosen = formData.getAll('sections').map(String)

  if (!name || chosen.length === 0) return

  // Only sections this role may reach, in the order the form offers them, so a
  // hand-posted field cannot smuggle in a section the role has no business with.
  // It would be filtered on read as well; refusing to store it keeps the row
  // honest about what it means.
  const allowed = new Set(availableSections(user.role).map((s) => s.key))
  const sections = chosen.filter((key) => allowed.has(key))
  if (sections.length === 0) return

  const key = existing && isCustomKey(existing) ? existing : `custom:${randomUUID()}`
  await saveRow(key, { name, sections, hidden: false })
  redirect('/profiles')
}

/** Rename a built-in without changing what is in it. */
export async function renameWorkspace(formData: FormData): Promise<void> {
  const key = String(formData.get('key') ?? '')
  const name = String(formData.get('name') ?? '').trim().slice(0, 40)
  if (!key) return
  const template = TEMPLATES.find((t) => t.key === key)
  await saveRow(key, { name: name || template?.name || null })
}

/** Delete one of your own. A template cannot be deleted, only hidden. */
export async function deleteWorkspace(formData: FormData): Promise<void> {
  const user = await requireStaff()
  const key = String(formData.get('key') ?? '')
  if (!key || !isCustomKey(key)) return

  const supabase = await createClient()
  const { error } = await supabase
    .from('user_workspaces')
    .delete()
    .eq('user_id', user.id)
    .eq('key', key)

  if (error) throw new Error(`Could not remove that: ${error.message}`)
  revalidatePath('/', 'layout')
  redirect('/profiles')
}
