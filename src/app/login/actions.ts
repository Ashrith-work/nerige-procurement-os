'use server'

import { createClient } from '@/lib/supabase/server'
import { normalisePhone } from '@/lib/validation/india'

export interface LoginState {
  status: 'idle' | 'sent' | 'error'
  message?: string
  /** Echoed back so the OTP step knows which number to verify against. */
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
 * Access to this system is by invitation only. Users are provisioned by a
 * Procurement Head; login merely proves control of an already-registered
 * identifier.
 */
const OTP_OPTIONS = { shouldCreateUser: false } as const

/** Internal staff: email magic link. */
export async function requestMagicLink(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase()

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { status: 'error', message: 'Enter a valid email address.' }
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
  // Distinguishing them turns the login form into a directory of who works
  // here — an enumeration oracle worth avoiding for the cost of one branch.
  if (error && !/user not found|signups not allowed/i.test(error.message)) {
    return { status: 'error', message: 'Could not send the link. Please try again.' }
  }

  return {
    status: 'sent',
    message: 'If that address is registered, a sign-in link is on its way.',
  }
}

/** Vendors: phone OTP. */
export async function requestPhoneOtp(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const raw = String(formData.get('phone') ?? '')
  const phone = normalisePhone(raw)

  if (!phone) {
    return { status: 'error', message: 'Enter a 10-digit mobile number.' }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithOtp({ phone, options: OTP_OPTIONS })

  if (error && !/user not found|signups not allowed/i.test(error.message)) {
    return { status: 'error', message: 'Could not send the code. Please try again.' }
  }

  return {
    status: 'sent',
    phone,
    message: `If that number is registered, a 6-digit code has been sent to ${phone}.`,
  }
}

/**
 * Verifies the SMS code and establishes the session.
 *
 * Unlike the request step, a wrong code IS reported plainly — the caller has
 * already proven possession of the number, so there is no enumeration risk, and
 * a vague error here would just make a vendor give up and reach for WhatsApp.
 */
export async function verifyPhoneOtp(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const phone = String(formData.get('phone') ?? '')
  const token = String(formData.get('code') ?? '').trim()

  if (!/^\d{6}$/.test(token)) {
    return { status: 'error', phone, message: 'Enter the 6-digit code from the SMS.' }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.verifyOtp({ phone, token, type: 'sms' })

  if (error) {
    return {
      status: 'error',
      phone,
      message: 'That code is incorrect or has expired. Request a new one.',
    }
  }

  return { status: 'idle' }
}
