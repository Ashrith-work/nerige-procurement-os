import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { isSupabaseConfigured } from '@/lib/auth/guards'

/**
 * Next.js 16 renamed the `middleware` convention to `proxy`. The runtime is
 * Node.js and is not configurable — which suits us, since the Supabase SSR
 * client is happier there than on the edge.
 *
 * Two jobs, in this order:
 *   1. Refresh the Supabase session and write rotated cookies. Server
 *      Components cannot set cookies, so this is the only place a refreshed
 *      token can be persisted.
 *   2. Bounce unauthenticated requests away from protected routes.
 *
 * This is NOT the authorisation boundary. Role checks happen in requireRole(),
 * and the real guarantee is RLS in the database. A proxy that enforced
 * authorisation alone would be bypassable by any route it forgot to match —
 * and forgetting a route is a matter of when, not if.
 */

// /auth/callback is gone along with OAuth and magic links. Sign-in now
// completes inside the Server Action, so there is no URL a provider redirects
// back to and nothing public to allow through.
const PUBLIC_PATHS = ['/login', '/auth/error', '/not-authorised']

/**
 * Endpoints that carry their OWN authentication and must never be session-gated.
 *
 * There is no browser and no cookie behind any of these. `/api/sync` proves it
 * is the scheduler with CRON_SECRET and a timing-safe comparison; the webhook
 * routes verify an HMAC over the raw body. Sending them to /login is not a
 * security measure, it is an outage: the caller is Vercel Cron or Shopify or
 * Meta, none of which follow a 307 to a sign-in page, and all of which record
 * the redirect as a delivery failure.
 *
 * This was a live defect. The matcher below covers everything except static
 * assets, so the scheduled sync had been redirecting to /login since the day it
 * was written — a cron that reports success while having synced nothing.
 *
 * Adding a route here is a decision: it means that route is responsible for its
 * own authentication, in full.
 */
const SELF_AUTHENTICATED_PATHS = ['/api/sync', '/api/whatsapp/webhook', '/api/shopify/webhook']

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

function isSelfAuthenticated(pathname: string): boolean {
  return SELF_AUTHENTICATED_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

export async function proxy(request: NextRequest) {
  const { pathname: path } = request.nextUrl

  // Before the Supabase check below, deliberately: these routes must answer
  // even on a deployment whose database is not configured yet, because the
  // caller needs a real status code rather than a redirect to a sign-in page.
  if (isSelfAuthenticated(path)) return NextResponse.next({ request })

  // No Supabase project behind this deployment. Every route that touches data
  // would throw, so send them all to the sign-in screen, which says so.
  if (!isSupabaseConfigured()) {
    if (path === '/login') return NextResponse.next({ request })
    const login = request.nextUrl.clone()
    login.pathname = '/login'
    login.search = ''
    return NextResponse.redirect(login)
  }

  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value)
          }
          response = NextResponse.next({ request })
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options)
          }
        },
      },
    },
  )

  // Must be getUser(), not getSession(): this call revalidates the token with
  // the auth server and refreshes it when expired. It is also what makes the
  // session available to Server Components further down the request.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  if (!user && !isPublic(pathname)) {
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = '/login'
    // Preserve the destination so a weaver tapping a deep link in an SMS lands
    // on the order after signing in, rather than on a generic home screen. That
    // is what keeps the portal one tap from notification to action.
    loginUrl.searchParams.set('next', pathname + request.nextUrl.search)
    return NextResponse.redirect(loginUrl)
  }

  // Someone already signed in has no use for the sign-in screen — send them to
  // their own home instead.
  //
  // GET only, and that is load-bearing. The sign-in Server Action POSTs to this
  // same path, and a Server Action expects a Server Action response: redirect
  // it and the client throws "An unexpected response was received from the
  // server" with no clue as to why. Worse, the action never runs, so signing in
  // as somebody else while a session is already open fails — which is exactly
  // what happens when the Nerige team open a weaver's login to check what she
  // sees, and on any shared machine.
  //
  // Letting the POST through costs nothing: the action replaces the session and
  // redirects properly on its own.
  if (user && pathname === '/login' && request.method === 'GET') {
    const home = request.nextUrl.clone()
    home.pathname = '/'
    home.search = ''
    return NextResponse.redirect(home)
  }

  return response
}

export const config = {
  // Everything except static assets and image optimisation. Without a matcher
  // the proxy would run on CSS and JS too, and the redirect above would break
  // the sign-in page's own stylesheet.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
