import type { Metadata, Viewport } from 'next'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale } from 'next-intl/server'
import { getSessionUser } from '@/lib/auth/session'
import { MESSAGES, isLocale } from '@/lib/i18n'
import { brandFontClass } from '@/lib/fonts'
import './globals.css'

/**
 * The tab, and what a bookmark of any screen here is called.
 *
 * The template means no page repeats the business name: a screen says
 * `title: 'Reorder'` and the tab reads "Reorder · Nerige Story". `icon.png` and
 * `apple-icon.png` sit beside this file and Next.js links them itself.
 */
export const metadata: Metadata = {
  title: {
    default: 'Nerige Story',
    template: '%s · Nerige Story',
  },
  description: 'Nerige Story operations — ordering, the warehouse and the numbers.',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Not maximumScale: 1. Pinning the zoom stops a weaver enlarging a SKU she
  // is copying onto a label by hand, which is the one thing these screens
  // exist to make readable.
}

/**
 * The provider sits at the root so a client component anywhere can call
 * `useTranslations` without each screen remembering to wrap itself.
 *
 * The session wins over the cookie. A cookie is a cache of a decision that
 * actually lives in `app_users.locale_override` and `vendors.default_locale`,
 * and the two can disagree — the admin changes a weaver's default while she is
 * signed in, or she signs in on a phone that has somebody else's cookie on it.
 * The database is the fact; the cookie only has to carry the sign-in screen,
 * where there is no session to ask.
 *
 * `lang` on <html> follows the same value. A screen reader pronouncing Kannada
 * with English phonemes is unusable, and a browser that misreads the language
 * offers to translate a page that is already in the right one.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [user, cookieLocale] = await Promise.all([getSessionUser(), getLocale()])

  const locale = user?.locale ?? (isLocale(cookieLocale) ? cookieLocale : 'en')
  const messages = MESSAGES[locale]

  return (
    // brandFontClass puts --font-montserrat and --font-nunito-sans on the root,
    // where globals.css picks them up as --font-heading and --font-body.
    <html lang={locale} className={brandFontClass}>
      <head>
        {/*
         * Every photograph in this application comes from the Shopify CDN, and
         * the reorder grid asks for up to 120 of them at once.
         *
         * Without this, the browser cannot even begin the first image request
         * until it has done a DNS lookup, a TCP handshake and a TLS negotiation
         * against a host it has never spoken to — and it only discovers it needs
         * to when it parses the first <img>. On a phone on Indian mobile data
         * that sequence is routinely 300-500ms of doing nothing, paid once per
         * page load, before a single photograph starts arriving.
         *
         * `preconnect` starts it during HTML parse instead, in parallel with
         * everything else. `crossOrigin` is required: images are fetched
         * anonymously, and a preconnect opened without it warms a connection the
         * image requests then decline to reuse.
         */}
        <link rel="preconnect" href="https://cdn.shopify.com" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://cdn.shopify.com" />
      </head>
      <body className="min-h-dvh antialiased">
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
