import { en, type Dictionary } from './en'
import { kn } from './kn'
import { ta } from './ta'
import { te } from './te'
import { hi } from './hi'

/**
 * Vendor-facing strings, from day one.
 *
 * Every string a weaver reads goes through here rather than being written into
 * a component. The catalogue titles alone span Kannada, Telugu and Devanagari
 * scripts, so the people this portal is for do not all read English — and
 * retrofitting a dictionary once forty components exist is a week of work
 * nobody schedules.
 *
 * The language comes from `app_users.locale`, not the URL. A weaver signs in on
 * her own phone and the portal is simply in her language; there is no locale to
 * pick, no prefix in the address bar and nothing to get wrong.
 */
export type Locale = 'en' | 'kn' | 'ta' | 'te' | 'hi'

export const LOCALES: Locale[] = ['en', 'kn', 'ta', 'te', 'hi']

export const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English',
  kn: 'ಕನ್ನಡ',
  ta: 'தமிழ்',
  te: 'తెలుగు',
  hi: 'हिन्दी',
}

/**
 * Partial by design. A missing key falls through to English rather than
 * rendering blank, so a half-translated language is usable on the day its first
 * string lands instead of on the day its last one does.
 */
type PartialDictionary = {
  [S in keyof Dictionary]?: Partial<Dictionary[S]>
}

const DICTIONARIES: Record<Locale, PartialDictionary> = { en, kn, ta, te, hi }

export function isLocale(value: string | null | undefined): value is Locale {
  return LOCALES.includes(value as Locale)
}

export function getDictionary(locale: string | null | undefined): Dictionary {
  if (!isLocale(locale) || locale === 'en') return en

  const overrides = DICTIONARIES[locale]
  const merged = {} as Record<string, Record<string, string>>

  for (const section of Object.keys(en) as (keyof Dictionary)[]) {
    merged[section] = { ...en[section], ...(overrides[section] ?? {}) }
  }

  return merged as unknown as Dictionary
}

/**
 * Best guess for a visitor with no session yet — the sign-in screen.
 *
 * Reads the browser's own preference rather than asking. A weaver whose phone
 * is set to Kannada should not have to read an English question about which
 * language she reads.
 */
export function localeFromAcceptLanguage(header: string | null): Locale {
  if (!header) return 'en'

  for (const part of header.split(',')) {
    const tag = part.split(';')[0].trim().toLowerCase().split('-')[0]
    if (isLocale(tag)) return tag
  }

  return 'en'
}

/**
 * "6 pieces", "1 piece".
 *
 * A count is the one number on the order screen a weaver acts on, so it reads
 * as a sentence rather than a bare digit. Languages that need different plural
 * rules override the two keys.
 */
export function formatPieces(t: Dictionary, n: number): string {
  const template = n === 1 ? t.order.pieces_one : t.order.pieces_other
  return template.replace('{n}', String(n))
}

export type { Dictionary }
