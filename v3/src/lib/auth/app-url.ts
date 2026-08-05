/**
 * Where this instance actually lives.
 *
 * Magic-link and OAuth redirects have to name an absolute URL, and getting it
 * wrong is silent until someone taps a link and lands on the wrong host. Vercel
 * gives every deployment its own hostname, so a single hard-coded value would
 * work on production and break on every preview.
 *
 * Order matters: an explicit NEXT_PUBLIC_APP_URL wins, because that is the one
 * that has to match Supabase's redirect allow list on the real site.
 */
export function appUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL
  if (explicit) return explicit.replace(/\/$/, '')

  // Set by Vercel on every deployment, without a scheme.
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL
  if (vercel) return `https://${vercel}`

  return 'http://localhost:3000'
}

/** Only ever redirect to a path on this origin, never to a supplied host. */
export function safeNext(next: string | null | undefined): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/'
}
