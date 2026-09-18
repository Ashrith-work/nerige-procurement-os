'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

/**
 * A header navigation link that says whether you are on it.
 *
 * The header carried no active state at all: five links, one of which is the
 * screen you are looking at, and nothing to say which. On a screen you reached
 * from a dashboard tile rather than from the menu, that is the difference
 * between knowing where you are and guessing.
 *
 * `aria-current="page"` as well as the styling, because a screen reader
 * otherwise hears five identical links too, and because the state must not be
 * carried by colour alone.
 */
export function NavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname()
  // A section is current when you are on it or inside it — /orders/ORD-000001 is
  // still Orders — but "/" is only ever itself.
  const active = pathname === href || (href !== '/' && pathname.startsWith(`${href}/`))

  return (
    <li>
      <Link
        href={href}
        aria-current={active ? 'page' : undefined}
        className={cn(
          // font-heading: the storefront sets its own navigation in Montserrat
          // at 0.05em, and this is the one row of the application that is
          // reading-the-shop rather than reading-the-data.
          'font-heading tracking-brand block min-h-11 rounded-full px-3.5 py-2.5 text-sm whitespace-nowrap',
          active
            // Blush fill from the storefront's own section scheme, with a
            // coral hairline. The brand accent is 1.88:1 on white and could
            // never be the only signal — weight, fill and aria-current already
            // carry the state, and the coral only reinforces it.
            ? 'bg-brand-accent-soft ring-brand-accent text-brand font-medium ring-1 ring-inset'
            : 'text-stone-600 hover:bg-stone-100 hover:text-stone-900',
        )}
      >
        {label}
      </Link>
    </li>
  )
}
