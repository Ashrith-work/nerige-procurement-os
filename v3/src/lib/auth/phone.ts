/**
 * Indian mobile numbers, in the one shape the database accepts.
 *
 * `app_users.phone` is constrained to E.164, and Supabase phone OTP expects the
 * same. A weaver types "98765 43210" — this is what turns that into
 * "+919876543210" without asking her to know what E.164 is.
 *
 * Rejects rather than guesses: Indian mobiles start 6-9 and are ten digits, so
 * a nine-digit number is a typo, not a number to pad.
 */
export function normalisePhone(input: string): string | null {
  const digits = input.replace(/\D/g, '')

  // 9876543210
  if (/^[6-9]\d{9}$/.test(digits)) return `+91${digits}`
  // 919876543210, with or without a leading + or 0
  if (/^91[6-9]\d{9}$/.test(digits)) return `+${digits}`
  if (/^0[6-9]\d{9}$/.test(digits)) return `+91${digits.slice(1)}`

  return null
}

/** For display back to the person who typed it: +91 98765 43210. */
export function formatPhone(e164: string): string {
  const match = e164.match(/^\+91(\d{5})(\d{5})$/)
  return match ? `+91 ${match[1]} ${match[2]}` : e164
}
