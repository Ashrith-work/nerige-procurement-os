import 'server-only'
import { cache } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getDictionary, resolveLocale, type Dictionary, type Locale } from '@/lib/i18n'
import { readImpersonation } from '@/lib/auth/impersonation'

/**
 * Five roles. Must stay in step with the `app_role` enum — migration 020.
 *
 *   admin              The owner. Every capability, and the ONLY role permitted
 *                      to correct anything a customer can already see:
 *                      published product details, images, deletion.
 *   procurement_head   Pooja. Reorder, orders, approval, sync. Unchanged.
 *   warehouse_manager  Submits new sarees and tracks them. That is the whole of
 *                      the job in this system.
 *   customer_support   Reads. Looks something up to answer a question. Writes
 *                      nothing, anywhere.
 *   vendor             The weaver.
 *
 * This is a hand-written union rather than a generated type, so adding a role
 * to the database without adding it here produces a silent `never` at every
 * comparison rather than a compile error. Both lists change together.
 */
export type AppRole =
  | 'admin'
  | 'procurement_head'
  | 'warehouse_manager'
  | 'customer_support'
  | 'vendor'

/** Everyone who works at Nerige. Read scope; never gate a write on this alone. */
const STAFF_ROLES: readonly AppRole[] = [
  'admin',
  'procurement_head',
  'warehouse_manager',
  'customer_support',
]

/**
 * Staff with operational authority. The application-side twin of
 * `app.is_internal()` in migration 021, and it must not drift from it: the
 * database grants these two roles orders, sales, sync, vendor credentials and
 * configuration, and a guard here that disagreed would either lock someone out
 * of a page whose data they can read, or show them a page full of nothing.
 */
const INTERNAL_ROLES: readonly AppRole[] = ['admin', 'procurement_head']

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

  // Both internal roles may stand in a weaver's shoes. An earlier draft of the
  // permission model made impersonation admin-only; that was wrong. It is not a
  // correction to anything a customer sees — it is how Pooja answers "what is
  // actually on her screen?" while she is on the phone to a weaver, and taking
  // it away would break a workflow that already exists to no security benefit.
  if (INTERNAL_ROLES.includes(user.role)) {
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

/**
 * Staff with operational authority: the owner, or Pooja.
 *
 * The name is kept despite now admitting two roles, because it is called from
 * roughly forty routes and actions. Renaming it would be forty diffs of pure
 * churn against a security boundary — the sort of change where the one file
 * that gets missed is the one that matters.
 *
 * Admitting `admin` here is the whole mechanism by which the owner inherits the
 * existing application. It is the exact counterpart of widening
 * `app.is_internal()` in migration 021, made once in each layer rather than by
 * writing `|| role === 'admin'` into forty files.
 */
export async function requireProcurement(): Promise<SessionUser> {
  return requireRole(...INTERNAL_ROLES)
}

/**
 * The owner, and nobody else.
 *
 * Gate on this for anything a customer can already see — published product
 * details, images, deletion — and for master data, configuration and user
 * management. The database says the same thing through `app.is_admin()`; this
 * exists so the refusal is a clean page rather than a working page full of
 * nothing, which is what pure RLS enforcement looks like to a person.
 */
export async function requireAdmin(): Promise<SessionUser> {
  return requireRole('admin')
}

/**
 * Any authenticated Nerige employee.
 *
 * Read scope. The intake queue and a product lookup are deliberately visible to
 * every staff role: a warehouse team has more than one person, and support
 * answering "where is this saree" has to be able to look up any of them. Writes
 * are gated per capability below, never on this.
 */
export async function requireStaff(): Promise<SessionUser> {
  return requireRole(...STAFF_ROLES)
}

/** Who may create a new saree. Mirrors `app.can_submit_intake()`. */
export async function requireIntakeSubmit(): Promise<SessionUser> {
  return requireRole('admin', 'warehouse_manager')
}

/**
 * Who may approve or reject at review. Mirrors `app.can_review_intake()`.
 *
 * Excludes `warehouse_manager` deliberately: the person who submits and shoots
 * a saree is not the person who signs it off.
 */
export async function requireIntakeReview(): Promise<SessionUser> {
  return requireRole(...INTERNAL_ROLES)
}

/** The strings this user reads, in the language on her profile. */
export async function getUserDictionary(): Promise<Dictionary> {
  const user = await getSessionUser()
  return getDictionary(user?.locale)
}

/**
 * Where each role belongs after signing in.
 *
 * Every role lands on the screen it opens the application to use, not on a hub
 * it has to navigate away from. A warehouse manager signs in to check the
 * sarees he submitted this morning; that list is his home, and a dashboard in
 * front of it is a tap he pays every time.
 *
 * `admin` lands on `/reorder` rather than an admin home because there is no
 * `/admin` index page — only its children exist. When one is built this is the
 * single line that changes.
 *
 * `/intake/queue` and `/lookup` arrive in later build steps. Nothing can reach
 * them before then, because the roles that land there cannot be created until
 * the screens exist to give them.
 */
export function homePathFor(role: AppRole): string {
  switch (role) {
    case 'vendor':
      return '/portal'
    case 'warehouse_manager':
      return '/intake/queue'
    case 'customer_support':
      return '/lookup'
    case 'admin':
    case 'procurement_head':
      return '/reorder'
  }
}
