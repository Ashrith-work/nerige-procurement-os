import 'server-only'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { resolveLocale, type Locale } from '@/lib/i18n'
import type { AppRole, SessionUser } from '@/lib/auth/session'

/**
 * The developer looking at the application as somebody else.
 *
 * The cookie names a target in one of three shapes:
 *
 *   user:<app_users.id>     a real login, of any role
 *   vendor:<vendors.id>     a weaving house — for a weaver with no login yet,
 *                           or to see the organisation rather than one member
 *   role:<app_role>         a role nobody holds yet (there is no
 *                           customer_support account today), rendered with
 *                           the developer's own id so "mine" lists are empty
 *                           rather than someone else's
 *
 * Like `nerige_impersonate`, it is NOT signed, and for the same reason: it
 * grants nothing by itself. It is read only after the real session resolves to
 * a developer, and a developer's database policies already admit SELECT on
 * every row while admitting no write at all. Forging it buys a non-developer
 * nothing, because their session never reaches this function.
 */
export const VIEW_AS_COOKIE = 'nerige_view_as'

export interface ViewAsContext {
  developerId: string
  developerName: string
  /** How the target was chosen, so the banner can say "role preview". */
  kind: 'user' | 'vendor' | 'role'
}

/** Roles a developer may preview. Not 'developer' — that is where they already are. */
export const VIEWABLE_ROLES: readonly Exclude<AppRole, 'developer'>[] = [
  'admin',
  'procurement_head',
  'warehouse_manager',
  'customer_support',
  'vendor',
]

type EmbeddedVendor = { id: string; display_name: string; code: string; default_locale: string }
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null))

/**
 * Resolves the target into a full SessionUser, or null when there is no valid
 * target — in which case the developer is simply themself.
 *
 * Re-reads the target from the database on every request, so a login that has
 * since been suspended or deleted stops rendering instead of being shown from a
 * stale cookie.
 */
export async function readViewAsTarget(developer: SessionUser): Promise<SessionUser | null> {
  const raw = (await cookies()).get(VIEW_AS_COOKIE)?.value
  if (!raw) return null

  const sep = raw.indexOf(':')
  if (sep <= 0) return null
  const kind = raw.slice(0, sep)
  const id = raw.slice(sep + 1)

  const viewAs = (k: ViewAsContext['kind']): ViewAsContext => ({
    developerId: developer.id,
    developerName: developer.fullName,
    kind: k,
  })

  const supabase = await createClient()

  if (kind === 'user') {
    const { data: profile } = await supabase
      .from('app_users')
      .select('id, role, full_name, email, phone, locale_override, status')
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle()

    if (!profile || profile.status !== 'active' || profile.role === 'developer') return null

    let vendor: EmbeddedVendor | null = null
    if (profile.role === 'vendor') {
      const { data: membership } = await supabase
        .from('vendor_users')
        .select('vendors(id, display_name, code, default_locale)')
        .eq('user_id', profile.id)
        .is('deleted_at', null)
        .maybeSingle()
      vendor = one(membership?.vendors as EmbeddedVendor | EmbeddedVendor[] | null)
      if (!vendor) return null
    }

    const vendorLocale = (vendor?.default_locale as Locale | undefined) ?? null
    return {
      id: profile.id,
      role: profile.role as AppRole,
      fullName: profile.full_name,
      email: profile.email,
      phone: profile.phone,
      locale: resolveLocale(profile.locale_override, vendorLocale),
      localeOverride: (profile.locale_override as Locale | null) ?? null,
      vendorId: vendor?.id ?? null,
      vendorName: vendor?.display_name ?? null,
      vendorCode: vendor?.code ?? null,
      vendorDefaultLocale: vendorLocale,
      viewAs: viewAs('user'),
    }
  }

  if (kind === 'vendor') {
    const { data: vendor } = await supabase
      .from('vendors')
      .select('id, display_name, code, default_locale')
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle()
    if (!vendor) return null

    const locale = (vendor.default_locale as Locale | undefined) ?? 'en'
    return {
      // The developer's own id: nothing a weaver's screen shows is keyed on the
      // login, only on the organisation.
      id: developer.id,
      role: 'vendor',
      fullName: vendor.display_name,
      email: null,
      phone: null,
      locale,
      localeOverride: null,
      vendorId: vendor.id,
      vendorName: vendor.display_name,
      vendorCode: vendor.code,
      vendorDefaultLocale: locale,
      viewAs: viewAs('vendor'),
    }
  }

  if (kind === 'role') {
    const role = id as AppRole
    // A vendor role with no organisation cannot render — pick a vendor instead.
    if (!VIEWABLE_ROLES.includes(role as never) || role === 'vendor') return null
    return {
      ...developer,
      role,
      fullName: `${ROLE_LABEL[role]} (preview)`,
      viewAs: viewAs('role'),
    }
  }

  return null
}

export const ROLE_LABEL: Record<AppRole, string> = {
  admin: 'Admin',
  procurement_head: 'Procurement head',
  warehouse_manager: 'Warehouse manager',
  customer_support: 'Customer support',
  vendor: 'Weaver',
  developer: 'Developer',
}
