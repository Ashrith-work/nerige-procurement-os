'use server'

import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { safeNext } from '@/lib/auth/guards'
import { toAuthEmail } from '@/lib/auth/user-id'
import { getDictionary, localeFromAcceptLanguage } from '@/lib/i18n'

export interface LoginState {
  status: 'idle' | 'error'
  message?: string
}

async function strings() {
  const h = await headers()
  return getDictionary(localeFromAcceptLanguage(h.get('accept-language')))
}

/**
 * The only way into this portal.
 *
 * Access is by invitation: every account is created by the Nerige team with
 * `npm run provision`, which sets the password. There is deliberately no signup
 * form, no password reset link and no third-party provider.
 *
 * `signInWithPassword` cannot create an account — unlike `signInWithOtp`, which
 * creates one by default, and unlike `signInWithOAuth`, which has no way to be
 * told not to. That property is why this is the whole auth surface: the only
 * code path that mints a user now lives in a script that runs from a laptop
 * with the service-role key, and there is no longer any route by which a
 * stranger can obtain a session against this project.
 *
 * A wrong user ID and a wrong password return the SAME message. Distinguishing
 * them turns the form into a directory of who works here, and the person who
 * genuinely mistyped is no better served by knowing which half was wrong.
 */
export async function signIn(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const t = (await strings()).login

  const userId = String(formData.get('userId') ?? '')
  const password = String(formData.get('password') ?? '')
  const next = safeNext(String(formData.get('next') ?? ''))

  // Resolved here rather than in the form so a handle and an email address take
  // exactly the same path. See src/lib/auth/user-id.ts.
  const email = toAuthEmail(userId)
  if (!email || !password) {
    return { status: 'error', message: t.wrongCredentials }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    return { status: 'error', message: t.wrongCredentials }
  }

  // Cookies were written by the client above — a Server Action can set them,
  // which is why sign-in lives here rather than in a route handler.
  //
  // Outside the error branch on purpose: redirect() signals by throwing, and
  // catching it would swallow the navigation.
  redirect(next)
}
