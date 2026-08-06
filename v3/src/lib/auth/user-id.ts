/**
 * The user ID is the thing someone types into the sign-in box.
 *
 * Supabase Auth identifies an account by email or phone, and nothing else. But
 * a weaver has neither a work email nor, necessarily, any email — asking her
 * for one to sign into a portal she was given access to is asking her to go and
 * get one first.
 *
 * So a user ID is either:
 *
 *   - an email address, used as-is — the Nerige team have work addresses
 *   - a short handle like `hdr`, mapped to `hdr@vendor.nerige.internal`
 *
 * The internal domain is deliberately not a real one. Nothing is ever sent to
 * these addresses: accounts are created with `email_confirm: true` by the
 * provisioning script, and there is no magic link, no password reset email and
 * no signup flow that would try to deliver anything. Using a domain that cannot
 * receive mail makes that permanent rather than merely true today.
 *
 * The mapping is pure and total, so the same handle always resolves to the same
 * account — the sign-in form and the provisioning script share this file rather
 * than each building the address their own way.
 */

/** Not a routable domain, on purpose. See above. */
export const INTERNAL_EMAIL_DOMAIN = 'vendor.nerige.internal'

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/**
 * Lowercase, starts alphanumeric, 2–32 characters. Deliberately narrow: a
 * handle is written on a slip of paper and typed on a phone keyboard, so
 * anything that invites a capital letter or a space is a support call.
 */
const HANDLE = /^[a-z0-9][a-z0-9._-]{1,31}$/

/**
 * The address Supabase Auth knows this user by, or null if the input could
 * never be one.
 *
 * Case and surrounding space are normalised here rather than at the call sites,
 * because "HDR " typed on a phone with autocapitalise on must reach the same
 * account as "hdr".
 */
export function toAuthEmail(userId: string): string | null {
  const id = userId.trim().toLowerCase()
  if (!id) return null

  if (id.includes('@')) return EMAIL.test(id) ? id : null

  return HANDLE.test(id) ? `${id}@${INTERNAL_EMAIL_DOMAIN}` : null
}

/**
 * The inverse, for anywhere a user ID is shown back to a human.
 *
 * A weaver should see `hdr`, not `hdr@vendor.nerige.internal` — the second
 * reads as an email address she might be expected to check.
 */
export function toDisplayUserId(email: string | null | undefined): string | null {
  if (!email) return null

  const suffix = `@${INTERNAL_EMAIL_DOMAIN}`
  return email.endsWith(suffix) ? email.slice(0, -suffix.length) : email
}

/** Whether this address is a derived one rather than a real mailbox. */
export function isInternalEmail(email: string | null | undefined): boolean {
  return Boolean(email?.endsWith(`@${INTERNAL_EMAIL_DOMAIN}`))
}
