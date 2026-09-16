import { redirect } from 'next/navigation'
import { requireUser, homePathFor } from '@/lib/auth/session'
import { getWorkspaceContext } from '@/lib/workspaces.server'

/**
 * The front door. Not a screen — it decides where this person starts.
 *
 * For staff that is their default workspace's first section: the job itself,
 * not a hub to navigate away from. `homePathFor(role)` remains the answer for a
 * weaver and the developer, and the fallback for anyone whose workspaces
 * resolve to none.
 */
export default async function Home() {
  const user = await requireUser()
  const { active, home } = await getWorkspaceContext(user)
  redirect(active ? home : homePathFor(user.role))
}
