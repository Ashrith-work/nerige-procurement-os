import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { safeNext } from '@/lib/auth/app-url'

/**
 * Where every sign-in lands: magic link, phone OTP and OAuth alike. Exchanges
 * the PKCE code for a session, then sends the user where they were headed.
 *
 * The provisioning check below is the important part, and it is here rather
 * than deeper in the app because OAuth cannot be told not to create accounts.
 *
 * `signInWithOtp` takes `shouldCreateUser: false`, so an unrecognised email or
 * phone gets nothing. `signInWithOAuth` has no equivalent — the first time
 * anyone with a Google account clicks that button, Supabase creates an auth
 * user for them. They can see nothing, because every policy resolves through
 * `app_users` and they have no row there. But they would hold a real session,
 * and a session with no profile sends `requireUser()` to /login while the proxy
 * sends /login back to /, which is an infinite redirect.
 *
 * So: no profile, no session. The token is thrown away at the door and they get
 * a sentence explaining that access is by invitation.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/'

  // The provider refused, or the user declined the consent screen.
  const providerError = searchParams.get('error')
  if (providerError) {
    return NextResponse.redirect(`${origin}/auth/error?reason=provider_refused`)
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/auth/error?reason=missing_code`)
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.exchangeCodeForSession(code)

  if (error || !data.user) {
    // Almost always an expired or already-consumed link.
    return NextResponse.redirect(`${origin}/auth/error?reason=invalid_link`)
  }

  const { data: profile } = await supabase
    .from('app_users')
    .select('id, status')
    .eq('id', data.user.id)
    .is('deleted_at', null)
    .maybeSingle()

  if (!profile || profile.status !== 'active') {
    await supabase.auth.signOut()
    return NextResponse.redirect(`${origin}/auth/error?reason=not_provisioned`)
  }

  return NextResponse.redirect(`${origin}${safeNext(next)}`)
}
