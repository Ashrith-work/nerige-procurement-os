import { redirect } from 'next/navigation'
import { requireIntakeSubmit } from '@/lib/auth/session'
import { withFlow } from '@/components/flow/flows'

/**
 * Adding a saree starts on the form, because that is the first thing that
 * happens: somebody is standing at the table with the saree in front of them.
 *
 * So this route is a door, not a screen — a hub asking "ready to begin?" is a
 * tap paid on every saree, fifty times a day. The guard runs here first, so a
 * role that may not submit gets the plain refusal rather than a bounce through
 * a screen it would also be refused.
 */
export default async function NewSareeFlowPage() {
  await requireIntakeSubmit()
  redirect(withFlow('/intake/new', 'new-saree'))
}
