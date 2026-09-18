import Link from 'next/link'
import { requireStaff } from '@/lib/auth/session'
import { getWorkspaceContext } from '@/lib/workspaces.server'
import { availableSections } from '@/lib/workspaces'
import { PageHeader } from '@/components/ui/primitives'

export const metadata = { title: 'All screens · Nerige' }

/**
 * Every screen this account can open, on one page.
 *
 * WHY THIS EXISTS. Workspaces made the navigation shorter by showing only the
 * job in hand — and the first thing that happened was that somebody went looking
 * for Insights, which had moved into a workspace they were not in, and concluded
 * it was gone. A shorter menu is only an improvement if the long one is still
 * somewhere.
 *
 * So this is the long one: the complete list, grouped the way the jobs group,
 * with the workspace each screen belongs to named beside it and the switcher
 * explained in a sentence. It is linked at the foot of every side panel and is
 * the answer to "where has X gone" for as long as the answer is "it is still
 * here".
 *
 * It grants nothing. `availableSections(role)` is the same intersection the
 * navigation uses, so this lists exactly what the role may open and no more.
 */

const GROUPS: { title: string; keys: readonly string[] }[] = [
  { title: 'Where the work stands', keys: ['today', 'work', 'numbers'] },
  { title: 'Ordering sarees', keys: ['order-flow', 'reorder', 'orders', 'weavers'] },
  { title: 'New sarees', keys: ['new-saree', 'intake', 'shooting', 'review', 'attributes', 'cropping', 'identify'] },
  { title: 'The warehouse', keys: ['receive-flow', 'inward', 'staff', 'performance'] },
  { title: 'Looking things up', keys: ['lookup', 'products', 'insights'] },
  { title: 'Running it', keys: ['signups', 'settings', 'profile'] },
]

export default async function AllScreensPage() {
  const user = await requireStaff()
  const { workspaces, active } = await getWorkspaceContext(user)

  const mine = availableSections(user.role)
  const byKey = new Map(mine.map((s) => [s.key, s]))

  // Which workspaces each screen sits in, so "it is in The numbers" is on the
  // page rather than something to be worked out from the switcher.
  const homes = new Map<string, string[]>()
  for (const workspace of workspaces) {
    for (const s of workspace.sections) {
      homes.set(s.key, [...(homes.get(s.key) ?? []), workspace.name])
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="All screens"
        subtitle={`Everything your account can open. You are in ${active?.name ?? 'no workspace'}; the switcher at the top right changes which of these the menu shows.`}
      />

      {GROUPS.map((group) => {
        const sections = group.keys.map((key) => byKey.get(key)).filter((s) => s !== undefined)
        if (sections.length === 0) return null

        return (
          <section key={group.title} className="space-y-2">
            <h2 className="text-sm font-medium text-stone-500">{group.title}</h2>
            <ul className="divide-y divide-stone-100 overflow-hidden rounded-xl border border-stone-200">
              {sections.map((s) => {
                const inWorkspaces = homes.get(s.key) ?? []
                return (
                  <li key={s.key}>
                    <Link
                      href={s.href}
                      className="flex min-h-11 flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3 hover:bg-stone-50"
                    >
                      <span className="font-medium text-stone-900">{s.label}</span>
                      <span className="text-sm text-stone-600">{s.blurb}</span>
                      <span className="ml-auto text-xs text-stone-500">
                        {inWorkspaces.length > 0 ? inWorkspaces.join(', ') : 'Not in a workspace yet'}
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}

      <p className="text-sm text-stone-600">
        Anything you use every day belongs in the workspace you work in.{' '}
        <Link href="/profiles" className="underline underline-offset-2">
          Change what each workspace holds
        </Link>
        .
      </p>
    </div>
  )
}
