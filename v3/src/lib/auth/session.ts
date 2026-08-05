import 'server-only'
import { cache } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getDictionary, type Dictionary } from '@/lib/i18n'

/**
 * Two roles, and only two. Pooja issues orders; the weaver reads and accepts
 * hers. There is no third person in this product.
 */
export type AppRole = 'procurement_head' | 'vendor'

export interface SessionUser {
  id: string
  role: AppRole
  fullName: string
  email: string | null
  phone: string | null
  locale: string
  /** The vendor organisation for a weaver; null for Pooja. */
  vendorId: string | null
  vendorName: string | null
  /** The SKU prefix. `PGW` for Pranav Gadwal. Null for Pooja. */
  vendorCode: string | null
}

/**
 * Resolves the current user, or null when unauthenticated.
 *
 * The role is read from `app_users` on every request rather than from the JWT.
 * A role cached in a token stays stale until refresh, which would leave a
 * suspended account working for up to an hour. `cache()` deduplicates this
 * within a single render pass, so the cost is one query per request, not one
 * per component.
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
  let vendorCode: string | null = null

  if (profile.role === 'vendor') {
    // RLS restricts this to the caller's own organisation, so the result is
    // authoritative rather than merely filtered.
    const { data: membership } = await supabase
      .from('vendor_users')
      .select('vendor_id, vendors(display_name, code)')
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .maybeSingle()

    vendorId = membership?.vendor_id ?? null

    // PostgREST returns an embedded resource as an array when it cannot prove
    // the relationship is to-one. vendor_users.vendor_id is a plain FK, so
    // there is at most one — normalise both shapes rather than assuming either.
    const embedded = membership?.vendors as
      | { display_name: string; code: string }
      | { display_name: string; code: string }[]
      | null
      | undefined
    const vendor = Array.isArray(embedded) ? embedded[0] : embedded
    vendorName = vendor?.display_name ?? null
    vendorCode = vendor?.code ?? null

    // A vendor login with no organisation can see nothing and do nothing.
    // Treated as no session so it fails at the door rather than as a confusing
    // empty portal.
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
    vendorCode,
  }
})

/**
 * Requires any authenticated user.
 *
 * The two "no session" cases are not the same and must not redirect to the same
 * place. Nobody signed in — send them to sign in. Signed in with Supabase but
 * with no active `app_users` row — do NOT, because the proxy sends anyone
 * holding a token away from /login and back to /, and the two would bounce
 * forever. That state is reachable by a user suspended mid-session, and would
 * be reachable by any stranger with a Google account if the OAuth callback did
 * not already refuse it.
 */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser()
  if (user) return user

  const supabase = await createClient()
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser()

  redirect(authUser ? '/auth/error?reason=not_provisioned' : '/login')
}

/**
 * Requires one of `roles`.
 *
 * This is defence in depth, not the security boundary — RLS is. Its job is to
 * produce a clean "not authorised" page instead of a working page full of
 * nothing, which is what pure RLS enforcement looks like to a user.
 */
export async function requireRole(...roles: AppRole[]): Promise<SessionUser> {
  const user = await requireUser()
  if (!roles.includes(user.role)) redirect('/not-authorised')
  return user
}

/** A weaver, with her organisation guaranteed present. */
export async function requireVendor(): Promise<SessionUser & { vendorId: string }> {
  const user = await requireRole('vendor')
  // getSessionUser refuses a vendor with no organisation, so this cannot fire;
  // it is here so the type is honest rather than asserted.
  if (!user.vendorId) redirect('/not-authorised')
  return user as SessionUser & { vendorId: string }
}

/** Pooja. */
export async function requireProcurement(): Promise<SessionUser> {
  return requireRole('procurement_head')
}

/** The strings this user reads, in the language on her profile. */
export async function getUserDictionary(): Promise<Dictionary> {
  const user = await getSessionUser()
  return getDictionary(user?.locale)
}

/** Where each role belongs after signing in. */
export function homePathFor(role: AppRole): string {
  return role === 'vendor' ? '/portal' : '/reorder'
}
