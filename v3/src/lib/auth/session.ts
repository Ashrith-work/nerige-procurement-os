import 'server-only'
import { cache } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getDictionary, resolveLocale, type Dictionary, type Locale } from '@/lib/i18n'
import { readImpersonation } from '@/lib/auth/impersonation'

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
  /**
   * The language this person reads, already resolved: her own override, then
   * her vendor's default, then English. Every screen takes it from here, so
   * the order is decided in one place rather than per page.
   */
  locale: Locale
  /** Null when she is following her vendor's default rather than overriding it. */
  localeOverride: Locale | null
  /** The vendor organisation for a weaver; null for Pooja. */
  vendorId: string | null
  vendorName: string | null
  /** The SKU prefix. `PGW` for Pranav Gadwal. Null for Pooja. */
  vendorCode: string | null
  /** What the admin set for this weaver. Null for Pooja. */
  vendorDefaultLocale: Locale | null
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
    .select('id, role, full_name, email, phone, locale_override, status')
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
  let vendorDefaultLocale: Locale | null = null

  if (profile.role === 'vendor') {
    // RLS restricts this to the caller's own organisation, so the result is
    // authoritative rather than merely filtered.
    const { data: membership } = await supabase
      .from('vendor_users')
      .select('vendor_id, vendors(display_name, code, default_locale)')
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .maybeSingle()

    vendorId = membership?.vendor_id ?? null

    // PostgREST returns an embedded resource as an array when it cannot prove
    // the relationship is to-one. vendor_users.vendor_id is a plain FK, so
    // there is at most one — normalise both shapes rather than assuming either.
    type EmbeddedVendor = { display_name: string; code: string; default_locale: string }
    const embedded = membership?.vendors as EmbeddedVendor | EmbeddedVendor[] | null | undefined
    const vendor = Array.isArray(embedded) ? embedded[0] : embedded
    vendorName = vendor?.display_name ?? null
    vendorCode = vendor?.code ?? null
    vendorDefaultLocale = (vendor?.default_locale as Locale | undefined) ?? null

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
    // Her override, then what the admin set for her weaver, then English. The
    // middle term is the one that matters: a Telugu-speaking weaver's portal is
    // Telugu on her first sign-in, before she has found a setting.
    locale: resolveLocale(profile.locale_override, vendorDefaultLocale),
    localeOverride: (profile.locale_override as Locale | null) ?? null,
    vendorId,
    vendorName,
    vendorCode,
    vendorDefaultLocale,
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

/**
 * A weaver, with her organisation guaranteed present — or Pooja standing in her
 * shoes.
 *
 * The second case is what makes "see exactly what that vendor sees" true rather
 * than approximate. An admin tool that reassembles a weaver's order screen from
 * the same rows is a SECOND rendering, and two renderings drift; the question
 * being asked when someone opens this is "what is on her screen?", and only her
 * screen answers it. So the real vendor routes serve it, with the vendor
 * identity swapped and `readOnly` set.
 *
 * Every write action behind these routes calls `refuseWhileImpersonating()`.
 * The database cannot make that distinction — an admin's own policies do permit
 * the write — so the application has to, and the audit log is what makes the
 * arrangement honest.
 */
export async function requireVendor(): Promise<
  SessionUser & { vendorId: string; readOnly: boolean }
> {
  const user = await requireUser()

  if (user.role === 'procurement_head') {
    const viewing = await readImpersonation()
    if (!viewing) redirect('/not-authorised')

    return {
      ...user,
      // Her language, not Pooja's. A screen rendered in English is not the
      // screen a Telugu-speaking weaver is looking at, and the reason for
      // opening it was to see hers.
      locale: viewing.locale,
      vendorId: viewing.id,
      vendorName: viewing.displayName,
      vendorCode: viewing.code,
      vendorDefaultLocale: viewing.locale,
      readOnly: true,
    }
  }

  if (user.role !== 'vendor') redirect('/not-authorised')
  // getSessionUser refuses a vendor with no organisation, so this cannot fire;
  // it is here so the type is honest rather than asserted.
  if (!user.vendorId) redirect('/not-authorised')

  return { ...user, vendorId: user.vendorId, readOnly: false }
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
