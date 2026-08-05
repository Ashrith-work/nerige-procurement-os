import Link from 'next/link'
import { requireUser, isInternal, canManageVendors, type AppRole } from '@/lib/auth/session'
import { isDemoMode } from '@/lib/demo'
import { signOut } from './actions'

interface NavItem {
  href: string
  label: string
  roles: AppRole[]
}

const INTERNAL: AppRole[] = ['founder', 'procurement_head', 'warehouse_manager']
const PROCUREMENT: AppRole[] = ['founder', 'procurement_head']

/**
 * Navigation is filtered by role, and the roles listed here mirror what the RLS
 * policies actually permit. Showing a link that leads to an empty table teaches
 * users the system is broken; showing nothing teaches them where their job is.
 *
 * Ordered by how often each role opens the thing, not by hierarchy. The
 * warehouse manager's entire job is the second item; the vendor sees two items
 * and they are the two questions they actually have — what do you want, and
 * what codes do I write.
 */
const NAV: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', roles: PROCUREMENT },
  { href: '/purchase-orders', label: 'Orders', roles: INTERNAL },
  { href: '/inbound', label: 'Inbound', roles: INTERNAL },
  { href: '/bills', label: 'Bills', roles: PROCUREMENT },
  { href: '/catalogue', label: 'Catalogue', roles: INTERNAL },
  { href: '/vendors', label: 'Vendors', roles: INTERNAL },
  { href: '/portal', label: 'My orders', roles: ['vendor'] },
  { href: '/portal/catalogue', label: 'My codes', roles: ['vendor'] },
]

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser()
  const items = NAV.filter((item) => item.roles.includes(user.role))

  return (
    // bg set here rather than on <body>: the root layout is now shared with the
    // vendor portal, which paints its own surfaces.
    <div className="flex min-h-dvh flex-col bg-stone-50 text-stone-900">
      {/* Unmissable, on every screen. Demo data must never be mistaken for real
          procurement data — a wrong vendor payment term read off a demo screen
          is a real-world mistake. */}
      {isDemoMode() && (
        <div className="bg-amber-400 px-4 py-1.5 text-center text-xs font-semibold text-amber-950">
          DEMO MODE · sample data · nothing here is saved
        </div>
      )}
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
          <Link href="/" className="shrink-0 font-semibold tracking-tight">
            Nerige<span className="text-stone-400"> Procurement</span>
          </Link>

          {/* Horizontal scroll rather than a hamburger: with at most four items
              a phone can show them all, and a menu would hide the one thing a
              warehouse manager opens twenty times a day. */}
          <nav className="flex-1 overflow-x-auto">
            <ul className="flex items-center gap-1">
              {items.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="block whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium text-stone-600 hover:bg-stone-100 hover:text-stone-900"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <div className="flex shrink-0 items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium leading-tight">{user.fullName}</p>
              <p className="text-xs leading-tight text-stone-500">
                {user.vendorName ?? user.role.replace(/_/g, ' ')}
              </p>
            </div>
            <form action={signOut}>
              <button
                type="submit"
                className="rounded-lg px-2 py-2 text-sm text-stone-500 hover:bg-stone-100 hover:text-stone-900"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>

      {isInternal(user.role) && !canManageVendors(user.role) && (
        <footer className="mx-auto w-full max-w-6xl px-4 pb-6">
          <p className="text-xs text-stone-400">
            You have read access to vendor records. Contact the Procurement Head to make changes.
          </p>
        </footer>
      )}
    </div>
  )
}
