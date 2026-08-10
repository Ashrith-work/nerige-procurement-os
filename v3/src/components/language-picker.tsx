'use client'

import { useRef, useTransition } from 'react'
import { LOCALES, LOCALE_NAMES, type Locale } from '@/lib/i18n'
import { setLocale } from '@/app/(app)/actions'

/**
 * The language control in the weaver's own header.
 *
 * Each language is written in itself — ಕನ್ನಡ, తెలుగు, தமிழ் — and never in
 * English. A picker that says "Kannada" is only readable by someone who already
 * reads English, which is the exact person who does not need it.
 *
 * It submits on change rather than behind a Save button. There is one value
 * here and its effect is visible immediately in every word on the screen, so a
 * second confirming tap is a step that only exists to be forgotten.
 *
 * No label text next to it: the native names are self-identifying, and the
 * accessible name carries the rest for a screen reader.
 */
export function LanguagePicker({ current, label }: { current: Locale; label: string }) {
  const form = useRef<HTMLFormElement>(null)
  const [pending, startTransition] = useTransition()

  return (
    <form ref={form} action={setLocale} className="contents">
      <select
        name="locale"
        defaultValue={current}
        aria-label={label}
        disabled={pending}
        onChange={(event) => {
          const formEl = event.currentTarget.form
          if (formEl) startTransition(() => setLocale(new FormData(formEl)))
        }}
        className="min-h-11 rounded-lg border border-stone-300 bg-white px-2 text-sm text-stone-700 disabled:opacity-50"
      >
        {LOCALES.map((locale) => (
          <option key={locale} value={locale}>
            {LOCALE_NAMES[locale]}
          </option>
        ))}
      </select>
    </form>
  )
}
