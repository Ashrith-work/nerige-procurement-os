import { getRequestConfig } from 'next-intl/server'
import { cookies } from 'next/headers'
import { DEFAULT_LOCALE, MESSAGES, isLocale } from '@/lib/i18n'

/**
 * next-intl, without a locale in the URL.
 *
 * There is deliberately no `/kn/portal`. A weaver signs in on her own phone and
 * the portal is simply in her language — she never picks one to get started,
 * and a link she is sent by the Nerige team cannot land her in the wrong one.
 * That means the locale comes from the session, not the path.
 *
 * The authoritative resolution — user override, then vendor default, then
 * English — happens in `getSessionUser()`, which is already querying
 * `app_users` on every request, and the layouts hand that locale straight to
 * `NextIntlClientProvider`. This file is what covers everything OUTSIDE a
 * session: the sign-in screen, the error pages, and any client component that
 * renders before a layout has resolved a user.
 *
 * The cookie is written by the sign-in action and by the language picker, so a
 * signed-out weaver returning to /login sees it in the language she last used
 * rather than in English.
 */
export const LOCALE_COOKIE = 'nerige_locale'

export default getRequestConfig(async () => {
  const jar = await cookies()
  const preferred = jar.get(LOCALE_COOKIE)?.value
  const locale = isLocale(preferred) ? preferred : DEFAULT_LOCALE

  return { locale, messages: MESSAGES[locale] }
})
