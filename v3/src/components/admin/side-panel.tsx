'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

/**
 * Pooja's panel. Fixed to the left, on every screen she can reach.
 *
 * "Always available" is the requirement and it is why this lives in the app
 * layout rather than in an `/admin` layout: it is present on /reorder and
 * /orders too, not only on the settings screens. She works across all of them
 * in one sitting and should never have to navigate back to a hub to get
 * somewhere.
 *
 * Below `lg` it collapses to a horizontal strip rather than a hamburger. There
 * are four destinations; hiding four links behind a button to save 44px of
 * height is a tap added to every journey to remove one row of pixels.
 *
 * The weaver never sees this. Her screens are a photograph and a code, and a
 * navigation rail down the side of a 380px phone is 20% of the picture.
 */
export interface PanelItem {
  href: string
  label: string
}

export function SidePanel({ items, heading, subheading }: {
  items: PanelItem[]
  heading: string
  subheading: string
}) {
  const pathname = usePathname()

  const isActive = (href: string) =>
    pathname === href || (href !== '/' && pathname.startsWith(`${href}/`))

  return (
    <nav
      aria-label={heading}
      className="no-print border-b border-stone-200 lg:h-full lg:w-56 lg:shrink-0 lg:border-r lg:border-b-0"
    >
      <div className="hidden px-4 pt-5 pb-3 lg:block">
        <p className="text-sm font-medium text-stone-900">{heading}</p>
        <p className="truncate text-xs text-stone-500">{subheading}</p>
      </div>

      <ul className="flex gap-1 overflow-x-auto px-3 py-2 lg:flex-col lg:px-2 lg:py-0">
        {items.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={isActive(item.href) ? 'page' : undefined}
              className={cn(
                'block min-h-11 rounded-lg px-3 py-2.5 text-sm whitespace-nowrap',
                isActive(item.href)
                  ? 'bg-stone-100 font-medium text-stone-900'
                  : 'text-stone-600 hover:bg-stone-50 hover:text-stone-900',
              )}
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
