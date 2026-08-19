import Link from 'next/link'
import { requireUser, type AppRole } from '@/lib/auth/session'
import { getDictionary } from '@/lib/i18n'
import { LanguagePicker } from '@/components/language-picker'
import { SidePanel } from '@/components/admin/side-panel'
import { ImpersonationBanner } from '@/components/admin/impersonation-banner'
import { readImpersonation } from '@/lib/auth/impersonation'
import { signOut } from './actions'

/**
 * Two kinds of chrome, because there are two kinds of user and their screens
 * are nothing alike.
 *
 * The weaver gets almost none: two links, her name, a language picker and a way
 * out. Every vendor screen is a phone screen and the photograph is meant to
 * dominate it — anything more competes with the saree for the only 380px that
 * matter.
 *
 * Pooja gets a panel down the left, present on every screen she can reach
 * rather than only inside a settings area. She moves between reordering,
 * orders, vendors and insights in one sitting, and a hub she has to return to
 * between each is a tap she pays every time.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser()
  const t = getDictionary(user.locale)
  // Both internal roles can impersonate, so both need the banner that says they
  // are doing it. Showing the weaver's screen without it is how somebody edits
  // the wrong vendor's order.
  const impersonating =
    user.role === 'procurement_head' || user.role === 'admin'
      ? await readImpersonation()
      : null

  if (user.role === 'vendor') {
    return (
      <div className="flex min-h-dvh flex-col bg-white text-stone-900">
        <header className="no-print border-b border-stone-200">
          <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 py-3">
            <Link href="/" className="shrink-0 font-medium tracking-tight">
              {t.login.brand}
            </Link>

            <nav className="flex-1 overflow-x-auto">
              <ul className="flex items-center gap-1">
                <NavLink href="/portal" label={t.nav.myOrders} />
                <NavLink href="/portal/catalogue" label={t.nav.myDesigns} />
              </ul>
            </nav>

            <div className="flex shrink-0 items-center gap-2">
              {/* Hers to change, in her own header. The admin sets the vendor
                  default; this is the exception to it. */}
              <LanguagePicker current={user.locale} label={t.common.language} />

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

  return (
    <div className="flex min-h-dvh flex-col bg-white text-stone-900">
      {/* Sits above everything, including the panel: whatever she does next on
          this session, it is happening as somebody else. */}
      {impersonating && <ImpersonationBanner vendor={impersonating} />}

      <header className="no-print border-b border-stone-200">
        <div className="flex w-full items-center gap-3 px-4 py-3">
          <Link href="/" className="shrink-0 font-medium tracking-tight">
            {t.login.brand}
          </Link>

          <nav className="flex-1 overflow-x-auto">
            <ul className="flex items-center gap-1">
              <NavLink href="/reorder" label={t.nav.reorder} />
              <NavLink href="/orders" label={t.nav.orders} />
            </ul>
          </nav>

          <div className="flex shrink-0 items-center gap-2">
            <span className="hidden text-sm text-stone-500 sm:block">{user.fullName}</span>
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

      <div className="flex flex-1 flex-col lg:flex-row">
        <SidePanel
          heading={user.fullName}
          subheading={user.email ?? ''}
          items={[
            { href: '/admin/profile', label: 'My profile' },
            { href: '/admin/vendors', label: 'My vendors' },
            { href: '/admin/products', label: 'Products' },
            // Admin only, matching the page's own requireAdmin(). A warehouse
            // manager following this link would be redirected, so it is not
            // offered to one.
            ...(user.role === 'admin'
              ? [{ href: '/admin/products/unidentified', label: 'To be identified' }]
              : []),
            { href: '/admin/insights', label: 'Insights' },
            { href: '/admin/settings', label: 'Settings' },
          ]}
        />

        <main className="w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
      </div>
    </div>
  )
}

function NavLink({ href, label }: { href: string; label: string }) {
  return (
    <li>
      <Link
        href={href}
        className="block min-h-11 rounded-lg px-3 py-2.5 text-sm whitespace-nowrap text-stone-600 hover:bg-stone-100 hover:text-stone-900"
      >
        {label}
      </Link>
    </li>
  )
}

export type { AppRole }
