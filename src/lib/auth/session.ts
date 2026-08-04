import 'server-only'
import { cache } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export type AppRole = 'founder' | 'procurement_head' | 'warehouse_manager' | 'vendor'

export interface SessionUser {
  id: string
  role: AppRole
  fullName: string
  email: string | null
  phone: string | null
  locale: string
  /** The vendor organisation for vendor users; null for internal staff. */
  vendorId: string | null
  vendorName: string | null
}

/**
 * Resolves the current user, or null when unauthenticated.
 *
 * The role is read from `app_users` on every request rather than from the JWT.
 * A role cached in a token stays stale until refresh, which would leave a
 * suspended user with working access for up to an hour — unacceptable in a
 * system that authorises payments. `cache()` deduplicates this within a single
 * render pass, so the cost is one query per request, not one per component.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createClient()

  // getUser() revalidates the token against the auth server. getSession() reads
  // it straight from the cookie and is therefore spoofable — never use it for
  // an authorisation decision.
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from('app_users')
    .select('id, role, full_name, email, phone, locale, status')
    .eq('id', user.id)
    .is('deleted_at', null)
    .single()

  // Authenticated with Supabase but no active application profile: an invited
  // user who was never provisioned, or one who has been suspended. Not a
  // session.
  if (!profile || profile.status !== 'active') return null

  let vendorId: string | null = null
  let vendorName: string | null = null

  if (profile.role === 'vendor') {
    // RLS restricts this to the caller's own organisation, so the result is
    // authoritative rather than merely filtered.
    const { data: membership } = await supabase
      .from('vendor_users')
      .select('vendor_id, vendors(display_name)')
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .maybeSingle()

    vendorId = membership?.vendor_id ?? null

    // PostgREST returns an embedded resource as an array when it cannot prove
    // the relationship is to-one. vendor_users.vendor_id is a plain FK, so
    // there is at most one — normalise both shapes rather than assuming either.
    const embedded = membership?.vendors as
      | { display_name: string }
      | { display_name: string }[]
      | null
      | undefined
    vendorName = (Array.isArray(embedded) ? embedded[0] : embedded)?.display_name ?? null

    // A vendor login with no organisation can see nothing and do nothing.
    // Treated as no session so it fails loudly at login rather than as a
    // confusing empty dashboard.
    if (!vendorId) return null
  }

  return {
    id: profile.id,
    role: profile.role as AppRole,
    fullName: profile.full_name,
    email: profile.email,
    phone: profile.phone,
    locale: profile.locale,
    vendorId,
    vendorName,
  }
})

/** Requires any authenticated user. Redirects to login otherwise. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  return user
}

/**
 * Requires one of `roles`.
 *
 * This is defence in depth, not the security boundary — RLS is. Its job is to
 * produce a clean "not authorised" page instead of a working page full of empty
 * tables, which is what pure RLS enforcement looks like to a user.
 */
export async function requireRole(...roles: AppRole[]): Promise<SessionUser> {
  const user = await requireUser()
  if (!roles.includes(user.role)) redirect('/not-authorised')
  return user
}

export const INTERNAL_ROLES: AppRole[] = [
  'founder',
  'procurement_head',
  'warehouse_manager',
]

export function isInternal(role: AppRole): boolean {
  return INTERNAL_ROLES.includes(role)
}

/** Roles permitted to create and amend procurement master data. */
export function canManageVendors(role: AppRole): boolean {
  return role === 'founder' || role === 'procurement_head'
}

/** Where each role belongs after signing in. */
export function homePathFor(role: AppRole): string {
  switch (role) {
    case 'vendor':
      return '/portal'
    case 'warehouse_manager':
      return '/inbound'
    default:
      return '/dashboard'
  }
}
