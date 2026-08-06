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

/** Only ever redirect to a path on this origin, never to a supplied host. */
export function safeNext(next: string | null | undefined): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/'
}
