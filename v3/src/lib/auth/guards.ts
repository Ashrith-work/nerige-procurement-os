/**
 * Two small guards the sign-in path depends on.
 *
 * This file used to also export `appUrl()`, which built the absolute URL that
 * magic-link and OAuth redirects had to name. Password sign-in completes inside
 * a Server Action and never leaves the origin, so there is no absolute URL to
 * get right, nothing to keep in step with a redirect allow-list, and no
 * `NEXT_PUBLIC_APP_URL` to set per environment. Deleting it removed a whole
 * class of "works on production, silently wrong on every preview" bug.
 */

/**
 * Whether this instance has a Supabase project behind it.
 *
 * A deployment with no credentials would otherwise call
 * `createServerClient(undefined, undefined)` in the proxy on every request and
 * return 500 for the whole site, including the sign-in page that would explain
 * the problem. Failing closed with a sentence beats failing opaquely.
 */
export function isSupabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  return Boolean(url && key && !/placeholder|YOUR-PROJECT/i.test(url))
}

/** Anything a browser or a log reader could be made to misread. */
function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0)
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}

/**
 * Only ever redirect to a path on this origin, never to a supplied host.
 *
 * `startsWith('/') && !startsWith('//')` alone is not enough. A browser treats a
 * backslash as a path separator in this position, so a target beginning slash-
 * backslash is read as a protocol-relative URL and leaves the origin — which
 * turns a redirect parameter into an open redirect, the classic way a sign-in
 * link is used to land somebody on a convincing copy of the sign-in page. A
 * control character hides the same trick from whoever reads the log afterwards.
 *
 * So: no backslash and no control character anywhere in it, and the character
 * after the leading slash must be an ordinary path character. Written as an
 * explicit scan rather than one clever regular expression because this is a
 * security boundary, and a reader should not have to count escapes to check it.
 */
export function safeNext(next: string | null | undefined, fallback = '/'): string {
  if (typeof next !== 'string' || next === '') return fallback
  if (next.includes('\\') || hasControlCharacter(next)) return fallback
  if (!next.startsWith('/') || next.startsWith('//')) return fallback
  return next
}
