import en from '../../../messages/en.json'
import kn from '../../../messages/kn.json'
import ta from '../../../messages/ta.json'
import te from '../../../messages/te.json'
import hi from '../../../messages/hi.json'

/**
 * Vendor-facing strings.
 *
 * Five languages, one JSON file each in `messages/`, and `en.json` is the shape
 * every other file is measured against — `npm run i18n:check` fails if any of
 * the four is missing a key English has, and `npm run build` runs it first. A
 * weaver never sees a blank space where a sentence should be, and never sees
 * English on a screen that is otherwise in her language.
 *
 * The files are JSON rather than TypeScript because next-intl reads them
 * directly and because a translator can be sent one without being sent a
 * codebase.
 *
 * WHAT IS NEVER TRANSLATED: SKU codes, saree names (DURGAKSHI, GAYATRIDEVI),
 * vendor codes and collection tokens. Those are Latin-script identifiers that
 * get copied onto a fabric label by hand and matched against EasyEcom; a
 * transliterated code matches nothing. Nothing in these files contains one.
 */
export type Locale = 'en' | 'kn' | 'ta' | 'te' | 'hi'

export const LOCALES: Locale[] = ['en', 'kn', 'ta', 'te', 'hi']

export const DEFAULT_LOCALE: Locale = 'en'

/** Each language named in itself. A picker in English is no use to someone who cannot read it. */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English',
  kn: 'ಕನ್ನಡ',
  ta: 'தமிழ்',
  te: 'తెలుగు',
  hi: 'हिन्दी',
}

/**
 * Per-locale number rendering.
 *
 * `useNativeNumerals` is false everywhere and that is deliberate, not an
 * oversight. A quantity on this portal is a number someone writes on a
 * dispatch note and reads back to a transporter over the phone, and Latin
 * digits are what appears on every Indian invoice, keypad and delivery docket
 * regardless of the language around them. Kannada and Devanagari digit forms
 * exist and are correct; they are simply not what these numbers are for.
 *
 * The flag exists so that judgement can be reversed per language without
 * touching a component: every number in the application already renders
 * through formatCount().
 */
export interface LocaleConfig {
  useNativeNumerals: boolean
  /** The Unicode numbering system used when the flag is on. */
  nativeNumberingSystem: string
  /** BCP-47 tag for Intl. Indian locales take the -IN region for digit grouping. */
  tag: string
}

export const LOCALE_CONFIG: Record<Locale, LocaleConfig> = {
  en: { useNativeNumerals: false, nativeNumberingSystem: 'latn', tag: 'en-IN' },
  kn: { useNativeNumerals: false, nativeNumberingSystem: 'knda', tag: 'kn-IN' },
  ta: { useNativeNumerals: false, nativeNumberingSystem: 'tamldec', tag: 'ta-IN' },
  te: { useNativeNumerals: false, nativeNumberingSystem: 'telu', tag: 'te-IN' },
  hi: { useNativeNumerals: false, nativeNumberingSystem: 'deva', tag: 'hi-IN' },
}

export type Dictionary = typeof en

/**
 * Partial by design at the type level, complete in fact.
 *
 * `i18n:check` is what guarantees completeness; this merge is the belt to its
 * braces. If a key ever does go missing — a hand-edited file, a bad merge — the
 * screen falls back to English for that one string rather than rendering the
 * key name or nothing at all.
 */
type PartialDictionary = {
  [S in keyof Dictionary]?: Partial<Dictionary[S]>
}

const DICTIONARIES: Record<Locale, PartialDictionary> = {
  en,
  kn: kn as PartialDictionary,
  ta: ta as PartialDictionary,
  te: te as PartialDictionary,
  hi: hi as PartialDictionary,
}

/** The raw message objects, for NextIntlClientProvider. */
export const MESSAGES: Record<Locale, Dictionary> = {
  en,
  kn: mergeOverEnglish('kn'),
  ta: mergeOverEnglish('ta'),
  te: mergeOverEnglish('te'),
  hi: mergeOverEnglish('hi'),
}

function mergeOverEnglish(locale: Locale): Dictionary {
  const overrides = DICTIONARIES[locale]
  const merged = {} as Record<string, Record<string, string>>

  for (const section of Object.keys(en) as (keyof Dictionary)[]) {
    merged[section] = { ...en[section], ...(overrides[section] ?? {}) }
  }

  return merged as unknown as Dictionary
}

export function isLocale(value: string | null | undefined): value is Locale {
  return LOCALES.includes(value as Locale)
}

export function getDictionary(locale: string | null | undefined): Dictionary {
  return isLocale(locale) ? MESSAGES[locale] : en
}

/**
 * Which language a person reads, resolved once.
 *
 * User override, then the vendor default the admin set, then English. The
 * middle term is the one that matters in practice: the Gadwal weaver is Telugu
 * speaking, so the admin sets PGW's default to `te` and her portal is Telugu
 * from her first sign-in, before she has touched a setting or found a picker.
 * The override exists for the second login at the same weaver who reads
 * something else.
 */
export function resolveLocale(
  userOverride: string | null | undefined,
  vendorDefault: string | null | undefined,
): Locale {
  if (isLocale(userOverride)) return userOverride
  if (isLocale(vendorDefault)) return vendorDefault
  return DEFAULT_LOCALE
}

/**
 * Best guess for a visitor with no session yet — the sign-in screen.
 *
 * Reads the browser's own preference rather than asking. A weaver whose phone
 * is set to Kannada should not have to read an English question about which
 * language she reads.
 */
export function localeFromAcceptLanguage(header: string | null): Locale {
  if (!header) return DEFAULT_LOCALE

  for (const part of header.split(',')) {
    const tag = part.split(';')[0].trim().toLowerCase().split('-')[0]
    if (isLocale(tag)) return tag
  }

  return DEFAULT_LOCALE
}

/**
 * Every number a vendor sees goes through here.
 *
 * Formatted as a string before it reaches a message, so the digits are decided
 * here and not by whatever ICU would have done inside the template. That is
 * what makes `useNativeNumerals` a single switch rather than an audit.
 */
export function formatCount(n: number, locale: Locale = DEFAULT_LOCALE): string {
  const cfg = LOCALE_CONFIG[locale] ?? LOCALE_CONFIG.en

  return new Intl.NumberFormat(cfg.tag, {
    numberingSystem: cfg.useNativeNumerals ? cfg.nativeNumberingSystem : 'latn',
  }).format(n)
}

/** `{n}` and friends, substituted. The one templating rule these files use. */
export function interpolate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in vars ? String(vars[key]) : match,
  )
}

/**
 * "6 pieces", "1 piece".
 *
 * A count is the one number on the order screen a weaver acts on, so it reads
 * as a sentence rather than a bare digit. Each language carries its own two
 * forms; Kannada, Tamil, Telugu and Hindi all distinguish one from many here.
 */
export function formatPieces(t: Dictionary, n: number, locale: Locale = DEFAULT_LOCALE): string {
  const template = n === 1 ? t.order.pieces_one : t.order.pieces_other
  return interpolate(template, { n: formatCount(n, locale) })
}
