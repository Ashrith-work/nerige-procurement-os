'use server'

import { createClient } from '@/lib/supabase/server'
import { normalisePhone, formatPhone } from '@/lib/auth/phone'
import { getDictionary } from '@/lib/i18n'
import { headers } from 'next/headers'
import { localeFromAcceptLanguage } from '@/lib/i18n'

export interface LoginState {
  status: 'idle' | 'sent' | 'error'
  message?: string
  /** Echoed back so the code step knows which number to verify against. */
  phone?: string
}

/**
 * THE most important flag in the auth layer: `shouldCreateUser: false`.
 *
 * Supabase's signInWithOtp CREATES AN ACCOUNT BY DEFAULT for any unrecognised
 * email or phone. Left at its default, anyone on the internet could type a
 * phone number and obtain an authenticated session. They would land with no
 * app_users row and therefore see nothing — RLS still holds — but they would
 * hold a valid token against our project, and every mistyped vendor number
 * would silently create an orphan auth user.
 *
 * Access to this portal is by invitation. Signing in proves control of an
 * already-registered number, nothing more.
 */
const OTP_OPTIONS = { shouldCreateUser: false } as const

async function strings() {
  const h = await headers()
  return getDictionary(localeFromAcceptLanguage(h.get('accept-language')))
}

/** Pooja: email magic link. */
export async function requestMagicLink(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const t = (await strings()).login
  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase()

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { status: 'error', message: t.enterValidEmail }
  }

  const next = String(formData.get('next') ?? '') || '/'
  const supabase = await createClient()

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      ...OTP_OPTIONS,
      emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  })

  // Deliberately identical response whether or not the address is registered.
  // Distinguishing them turns the sign-in form into a directory of who works
  // here — an enumeration oracle worth avoiding for the cost of one branch.
  if (error && !/user not found|signups not allowed/i.test(error.message)) {
    return { status: 'error', message: t.couldNotSendLink }
  }

  return { status: 'sent', message: t.linkSent }
}

/** The weaver: phone OTP. */
export async function requestPhoneOtp(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const t = (await strings()).login
  const phone = normalisePhone(String(formData.get('phone') ?? ''))

  if (!phone) return { status: 'error', message: t.enterMobile }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithOtp({ phone, options: OTP_OPTIONS })

  if (error && !/user not found|signups not allowed/i.test(error.message)) {
    return { status: 'error', message: t.couldNotSendCode }
  }

  return { status: 'sent', phone, message: `${t.codeSent} ${formatPhone(phone)}` }
}

/**
 * Verifies the SMS code and establishes the session.
 *
 * Unlike the request step, a wrong code IS reported plainly — the caller has
 * already proven possession of the number, so there is no enumeration risk, and
 * a vague error here would just make a weaver give up and reach for WhatsApp.
 */
export async function verifyPhoneOtp(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const t = (await strings()).login
  const phone = String(formData.get('phone') ?? '')
  const token = String(formData.get('code') ?? '').trim()

  if (!/^\d{6}$/.test(token)) {
    return { status: 'error', phone, message: t.enterSixDigits }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.verifyOtp({ phone, token, type: 'sms' })

  if (error) return { status: 'error', phone, message: t.codeWrong }

  return { status: 'idle' }
}
