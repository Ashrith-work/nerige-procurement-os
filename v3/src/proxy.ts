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
 * This is NOT the authorisation boundary. Role checks happen in requireRole(),
 * and the real guarantee is RLS in the database. A proxy that enforced
 * authorisation alone would be bypassable by any route it forgot to match —
 * and forgetting a route is a matter of when, not if.
 */

const PUBLIC_PATHS = ['/login', '/auth/callback', '/auth/error', '/not-authorised']

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

export async function proxy(request: NextRequest) {
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
  // the sign-in page's own stylesheet.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
