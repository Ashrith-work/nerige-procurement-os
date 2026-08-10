import 'server-only'
import { cache } from 'react'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import type { Locale } from '@/lib/i18n'

/**
 * Pooja looking at a weaver's portal as that weaver sees it.
 *
 * The cookie holds a vendor id and nothing else, and it is NOT signed. That is
 * a deliberate choice rather than a shortcut: this cookie grants no access on
 * its own. Every read of it starts by resolving the session and refusing
 * anybody who is not internal, and an internal user can already select every
 * vendor's rows under `products_select_internal`. Forging it therefore buys a
 * weaver nothing — her own session fails the role check on the first line — and
 * buys an admin only what she already had. A signature here would protect a
 * boundary that is not where the boundary is.
 *
 * What it must not become is a way to WRITE as somebody else. That is enforced
 * in the action layer, by `refuseWhileImpersonating()`, because the database
 * genuinely permits those writes for an admin and cannot tell which hat she is
 * wearing.
 */
export const IMPERSONATION_COOKIE = 'nerige_impersonate'

export interface ImpersonatedVendor {
  id: string
  code: string
  displayName: string
  /** So the screens render in the language she actually reads. */
  locale: Locale
}

/**
 * The vendor currently being viewed, or null.
 *
 * Re-resolves the vendor from the database on every request rather than
 * trusting the cookie's contents, so a vendor that has since been archived or
 * deleted stops rendering rather than showing a stale name in the banner.
 */
export const readImpersonation = cache(async (): Promise<ImpersonatedVendor | null> => {
  const jar = await cookies()
  const vendorId = jar.get(IMPERSONATION_COOKIE)?.value
  if (!vendorId) return null

  const supabase = await createClient()

  // Role gate first. `vendors_select_own` would let a weaver read exactly one
  // row here — her own — so without this a forged cookie carrying her own id
  // would put her in a banner-wrapped copy of her own portal. Harmless, and
  // still not a state this application should be able to reach.
  const { data: me } = await supabase
    .from('app_users')
    .select('role')
    .eq('id', (await supabase.auth.getUser()).data.user?.id ?? '')
    .is('deleted_at', null)
    .maybeSingle()

  if (me?.role !== 'procurement_head') return null

  const { data: vendor } = await supabase
    .from('vendors')
    .select('id, code, display_name, default_locale')
    .eq('id', vendorId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!vendor) return null

  return {
    id: vendor.id as string,
    code: vendor.code as string,
    displayName: vendor.display_name as string,
    locale: (vendor.default_locale as Locale) ?? 'en',
  }
})

/**
 * The guard every vendor-facing write action calls first.
 *
 * Read-only is the entire promise of this feature. A promised date typed by
 * Pooja while wearing a weaver's face is indistinguishable, afterwards, from
 * one the weaver committed to — and the two of them arguing from differently
 * remembered versions of the same date is precisely what this portal was built
 * to stop happening.
 */
export async function refuseWhileImpersonating(): Promise<void> {
  const active = await readImpersonation()
  if (active) {
    throw new Error(
      'This portal is open in read-only view. Stop viewing as ' +
        `${active.code} before changing anything.`,
    )
  }
}
