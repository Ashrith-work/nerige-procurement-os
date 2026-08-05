import { NextResponse, type NextRequest } from 'next/server'
import { isDemoMode } from '@/lib/demo'
import { isDemoRole, DEMO_USERS } from '@/lib/demo/procurement'
import { DEMO_COOKIE } from '@/lib/auth/session'
import { homePathFor } from '@/lib/auth/session'

/**
 * Signs in as one of the demo roles.
 *
 *   /demo-login?as=procurement_head
 *   /demo-login?as=warehouse_manager
 *   /demo-login?as=vendor
 *   /demo-login?as=founder      (the default)
 *
 * Returns 404 — not 403 — when demo mode is off, so a deployed instance does
 * not even advertise that this route exists. isDemoMode() is hard-off in
 * production regardless of environment variables.
 *
 * Each role lands on its own home screen rather than a shared one, because that
 * is the actual claim being demonstrated: these three people do not share a
 * starting page and should not be given one.
 */
export async function GET(request: NextRequest) {
  if (!isDemoMode()) {
    return new NextResponse('Not found', { status: 404 })
  }

  const requested = request.nextUrl.searchParams.get('as') ?? 'founder'
  const role = isDemoRole(requested) ? requested : 'founder'

  const destination = homePathFor(DEMO_USERS[role].role)
  const response = NextResponse.redirect(new URL(destination, request.nextUrl.origin))

  response.cookies.set(DEMO_COOKIE, role, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 8,
  })
  return response
}
