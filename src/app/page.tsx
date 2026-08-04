import { redirect } from 'next/navigation'
import { getSessionUser, homePathFor } from '@/lib/auth/session'

/**
 * Role dispatcher. There is deliberately no shared landing page: a Founder, a
 * Warehouse Manager and a vendor have nothing useful in common on screen one,
 * and a generic hub would cost every user a click on every visit.
 */
export default async function RootPage() {
  const user = await getSessionUser()
  redirect(user ? homePathFor(user.role) : '/login')
}
