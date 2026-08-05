import Link from 'next/link'
import { requireUser, type AppRole } from '@/lib/auth/session'
import { getDictionary } from '@/lib/i18n'
import { signOut } from './actions'

/**
 * Deliberately thin chrome.
 *
 * Every vendor screen is a phone screen, and the photograph is meant to
 * dominate it. Two links, a name and a way out — anything more competes with
 * the saree for the only 380px that matter.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser()
  const t = getDictionary(user.locale)

  const nav: { href: string; label: string }[] =
    user.role === 'vendor'
      ? [
          { href: '/portal', label: t.nav.myOrders },
          { href: '/portal/catalogue', label: t.nav.myDesigns },
        ]
      : [
          { href: '/reorder', label: t.nav.reorder },
          { href: '/orders', label: t.nav.orders },
        ]

  return (
    <div className="flex min-h-dvh flex-col bg-white text-stone-900">
      <header className="no-print border-b border-stone-200">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 py-3">
          <Link href="/" className="shrink-0 font-medium tracking-tight">
            {t.login.brand}
          </Link>

          <nav className="flex-1 overflow-x-auto">
            <ul className="flex items-center gap-1">
              {nav.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="block min-h-11 whitespace-nowrap rounded-lg px-3 py-2.5 text-sm text-stone-600 hover:bg-stone-100 hover:text-stone-900"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <div className="flex shrink-0 items-center gap-2">
            <span className="hidden text-sm text-stone-500 sm:block">
              {user.vendorName ?? user.fullName}
            </span>
            <form action={signOut}>
              <button
                type="submit"
                className="min-h-11 rounded-lg px-3 text-sm text-stone-500 hover:bg-stone-100 hover:text-stone-900"
              >
                {t.common.signOut}
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
    </div>
  )
}

export type { AppRole }
