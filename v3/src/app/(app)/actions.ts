'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { requireUser } from '@/lib/auth/session'
import { isLocale } from '@/lib/i18n'
import { LOCALE_COOKIE } from '@/i18n/request'

export async function signOut() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/login')
}

/**
 * A weaver changing her own language.
 *
 * Writes `app_users.locale_override`, which is the exception to the vendor
 * default rather than a replacement for it — so a second login at the same
 * weaver who reads Kannada can have Kannada without moving the whole house off
 * Telugu.
 *
 * The write goes through the caller's own RLS session, not the service role.
 * `app_users_update_self` already permits exactly this: her own row, with role
 * and status pinned to what they already were. A language picker has no
 * business holding a key that could change either.
 *
 * The cookie is set alongside so the sign-in screen greets her in the same
 * language next time, when there is no session left to ask.
 */
export async function setLocale(formData: FormData): Promise<void> {
  const user = await requireUser()
  const locale = String(formData.get('locale') ?? '')

  if (!isLocale(locale)) return

  const supabase = await createClient()
  const { error } = await supabase
    .from('app_users')
    .update({ locale_override: locale })
    .eq('id', user.id)

  if (error) return

  const jar = await cookies()
  jar.set(LOCALE_COOKIE, locale, {
    httpOnly: false,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  })

  // Every string on every screen came from this value; nothing cached under the
  // old language is still correct.
  revalidatePath('/', 'layout')
}
