import Link from 'next/link'
import type { AppRole } from '@/lib/auth/session'
import { section } from '@/lib/workspaces'
import { cn } from '@/lib/utils'

/**
 * The strip that names the other two dashboards.
 *
 * There are three of them now — Today, In progress, Numbers — and they do
 * different jobs on purpose. That only works if moving between them is one
 * click from any of them; a person who has to find the workspace switcher to
 * get from what is waiting to what is in flight will simply go back to wanting
 * one screen with everything on it.
 *
 * Roles come from `SECTIONS` rather than being repeated here, so a role that is
 * refused `/numbers` is never offered a link to it — and when that list changes
 * the strip changes with it. The current screen is a plain element, not a link
 * to itself, and carries `aria-current` so a screen reader says which of the
 * three is open.
 */

export type DashboardKey = 'today' | 'work' | 'numbers'

const KEYS: readonly DashboardKey[] = ['today', 'work', 'numbers']

export function DashboardStrip({ current, role }: { current: DashboardKey; role: AppRole }) {
  const items = KEYS.map((key) => ({ key, section: section(key) })).filter(
    (item) => item.section !== null && item.section.roles.includes(role),
  )

  // One destination is not navigation. A customer support login reaches only
  // Today, and a strip naming a single screen is furniture.
  if (items.length < 2) return null

  return (
    <nav aria-label="Dashboards">
      <ul className="flex flex-wrap gap-1 border-b border-stone-200 pb-2">
        {items.map(({ key, section: s }) => {
          const here = key === current
          const className = cn(
            'inline-flex min-h-11 items-center rounded-lg px-3 text-sm',
            here ? 'bg-stone-900 font-medium text-white' : 'text-stone-600 hover:bg-stone-100 hover:text-stone-900',
          )

          return (
            <li key={key}>
              {here ? (
                <span aria-current="page" className={className}>
                  {s!.label}
                </span>
              ) : (
                <Link href={s!.href} className={className} title={s!.blurb}>
                  {s!.label}
                </Link>
              )}
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
