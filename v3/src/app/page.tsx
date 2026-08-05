import { redirect } from 'next/navigation'
import { requireUser, homePathFor } from '@/lib/auth/session'

/**
 * The front door. Not a screen — it decides which of the two products you are
 * looking at and sends you there. Pooja gets the reorder grid; a weaver gets
 * her orders.
 */
export default async function Home() {
  const user = await requireUser()
  redirect(homePathFor(user.role))
}
