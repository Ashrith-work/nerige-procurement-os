import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * Magic-link landing point. Exchanges the PKCE code for a session, then sends
 * the user where they were originally headed.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/'

  if (!code) {
    return NextResponse.redirect(`${origin}/auth/error?reason=missing_code`)
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    // Almost always an expired or already-consumed link.
    return NextResponse.redirect(`${origin}/auth/error?reason=invalid_link`)
  }

  // Only ever redirect to a path on this origin. Without this check, an
  // attacker could craft ?next=https://evil.example and turn our own login
  // flow into an open redirect that looks entirely legitimate to the user.
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/'

  return NextResponse.redirect(`${origin}${safeNext}`)
}
