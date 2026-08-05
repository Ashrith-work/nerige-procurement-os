import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

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
 * This is NOT the authorisation boundary. Role checks happen in
 * requireRole(), and the real guarantee is RLS in the database. A proxy that
 * enforced authorisation alone would be bypassable by any route it forgot to
 * match — and forgetting a route is a matter of when, not if.
 */

/**
 * Routes reachable without a session. Everything else requires one.
 *
 * `/demo-login` is listed because it must be reachable while signed out — the
 * route itself returns 404 unless demo mode is on, and demo mode is hard-off in
 * production, so this adds no exposure to a deployed instance.
 */
const PUBLIC_PATHS = [
  '/login',
  '/auth/callback',
  '/auth/error',
  '/not-authorised',
  '/demo-login',
]

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

/**
 * Demo-mode gate, duplicated here rather than imported.
 *
 * src/lib/demo is marked `server-only`, which the proxy module graph does not
 * accept. The logic is two environment reads, and both copies lead with the
 * same unconditional production check — a divergence would fail closed.
 */
function demoSessionPresent(request: NextRequest): boolean {
  if (process.env.NODE_ENV === 'production') return false
  if (process.env.DEMO_MODE !== '1') return false
  // Any non-empty value: the cookie carries WHICH role is being demonstrated
  // ('founder', 'vendor', …), and the legacy '1' from the single-account form
  // still counts. Whether the value names a real role is decided in
  // getSessionUser(), which is where an unknown value resolves to no session —
  // this check only decides whether to skip the Supabase round trip.
  return Boolean(request.cookies.get('nerige_demo')?.value)
}

export async function proxy(request: NextRequest) {
  // Demo sessions never reach Supabase — there is no project configured when
  // demo mode is in use, and calling getUser() would just add latency before
  // failing.
  if (demoSessionPresent(request)) {
    return NextResponse.next({ request })
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
    // Preserve the destination so a vendor tapping a deep-link in an SMS lands
    // on the PO after signing in, rather than on a generic dashboard. This is
    // the mechanism that keeps the portal to one tap from notification to
    // action — the core mitigation for portal-only adoption risk.
    loginUrl.searchParams.set('next', pathname + request.nextUrl.search)
    return NextResponse.redirect(loginUrl)
  }

  if (user && pathname === '/login') {
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
  // the login page's own stylesheet.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
