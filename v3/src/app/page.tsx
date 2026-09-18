import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { requireUser, homePathFor, type AppRole } from '@/lib/auth/session'
import { getWorkspaceContext } from '@/lib/workspaces.server'

/**
 * The front door. Not a screen — it decides where this person starts.
 *
 * THE SUBDOMAIN IS A DOOR, NOT A GATE. `warehouse.nerigestory.dev` opens the
 * warehouse, `weavers.` opens a weaver's portal, `dev.` opens the switcher, and
 * `os.` (or any other host) opens whatever that person's default workspace is.
 * It is a shortcut for the people who only ever want one part of this — the
 * warehouse tablet gets a bookmark that lands on the work — and nothing more:
 *
 *   - Every screen stays reachable from every host. Nobody is locked out of
 *     something by having typed the wrong address.
 *   - A host NEVER widens access. The hint is honoured only when the person's
 *     role could already open that screen; otherwise they land on their own
 *     home, not on "not authorised", because arriving at the wrong door is not
 *     an error worth showing somebody.
 *
 * So this file cannot be used to reach anything, and a forged Host header buys
 * exactly nothing: the role check below is the same one the destination screen
 * runs for itself.
 */

const HOST_HOME: Record<string, { path: string; roles: readonly AppRole[] }> = {
  warehouse: { path: '/warehouse', roles: ['admin', 'warehouse_manager'] },
  weavers: { path: '/portal', roles: ['vendor'] },
  dev: { path: '/dev', roles: ['developer'] },
}

export default async function Home() {
  const user = await requireUser()

  const host = (await headers()).get('host') ?? ''
  const subdomain = host.split(':')[0].split('.')[0].toLowerCase()
  const door = HOST_HOME[subdomain]
  if (door && door.roles.includes(user.role)) redirect(door.path)

  const { active, home } = await getWorkspaceContext(user)
  redirect(active ? home : homePathFor(user.role))
}
