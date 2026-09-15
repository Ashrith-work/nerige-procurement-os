'use server'

import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { homePathFor, requireDeveloper, type AppRole } from '@/lib/auth/session'
import { VIEW_AS_COOKIE, VIEWABLE_ROLES } from '@/lib/auth/view-as'

/**
 * Start viewing the application as a user, a weaving house, or a bare role.
 *
 * Both actions go through `requireDeveloper()`, which reads the REAL session.
 * `requireUser()` refuses every Server Action while a view-as target is set, so
 * "switch" and "stop" would otherwise be locked out by the very state they exist
 * to leave.
 *
 * The log row is written before the cookie, and a failed write aborts, for the
 * reason migration 012 gives: an audit trail that is best-effort has a hole in
 * it exactly where somebody would want one. A bare-role preview has no person
 * behind it, so it logs against the developer's own id with that role.
 */
export async function startViewAs(formData: FormData): Promise<void> {
  const developer = await requireDeveloper()
  const target = String(formData.get('target') ?? '')
  const sep = target.indexOf(':')
  if (sep <= 0) return
  const kind = target.slice(0, sep)
  const id = target.slice(sep + 1)

  const supabase = await createClient()
  let logUserId: string = developer.id
  let logRole: AppRole
  let landing: string

  if (kind === 'user') {
    const { data: profile } = await supabase
      .from('app_users')
      .select('id, role, status')
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle()
    if (!profile || profile.status !== 'active' || profile.role === 'developer') return
    logUserId = profile.id
    logRole = profile.role as AppRole
    landing = homePathFor(logRole)
  } else if (kind === 'vendor') {
    const { data: vendor } = await supabase
      .from('vendors')
      .select('id')
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle()
    if (!vendor) return
    logRole = 'vendor'
    landing = '/portal'
  } else if (kind === 'role' && VIEWABLE_ROLES.includes(id as never) && id !== 'vendor') {
    logRole = id as AppRole
    landing = homePathFor(logRole)
  } else {
    return
  }

  const { error } = await supabase
    .from('view_as_log')
    .insert({ developer_user_id: developer.id, target_user_id: logUserId, target_role: logRole })
  if (error) throw new Error(`Could not record the view: ${error.message}`)

  ;(await cookies()).set(VIEW_AS_COOKIE, `${kind}:${id}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    // Short, like the impersonation cookie: a forgotten view-as is how a
    // developer spends an afternoon debugging a screen that is not theirs.
    maxAge: 60 * 60 * 2,
  })

  redirect(landing)
}

export async function stopViewAs(): Promise<void> {
  const developer = await requireDeveloper()
  ;(await cookies()).delete(VIEW_AS_COOKIE)

  const supabase = await createClient()
  const { data: open } = await supabase
    .from('view_as_log')
    .select('id')
    .eq('developer_user_id', developer.id)
    .is('ended_at', null)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (open) {
    await supabase
      .from('view_as_log')
      .update({ ended_at: new Date().toISOString() })
      .eq('id', open.id)
  }

  redirect('/dev')
}
