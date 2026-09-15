import Link from 'next/link'
import { requireUser, type AppRole } from '@/lib/auth/session'
import { getDictionary } from '@/lib/i18n'
import { LanguagePicker } from '@/components/language-picker'
import { SidePanel } from '@/components/admin/side-panel'
import { ImpersonationBanner } from '@/components/admin/impersonation-banner'
import { readImpersonation } from '@/lib/auth/impersonation'
import { ViewAsBanner } from '@/components/dev/view-as-banner'
import { navFor } from '@/lib/nav'
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
    (user.role === 'procurement_head' || user.role === 'admin') && !user.viewAs
      ? await readImpersonation()
      : null

  // A developer looking as somebody else: the banner goes above whichever
  // chrome that person gets, so the screen below is theirs, unaltered.
  const viewAsBanner = user.viewAs ? (
    <ViewAsBanner name={user.vendorCode ? `${user.fullName} · ${user.vendorCode}` : user.fullName} role={user.role} kind={user.viewAs.kind} />
  ) : null

  if (user.role === 'developer') {
    return (
      <div className="flex min-h-dvh flex-col bg-white text-stone-900">
        <header className="no-print border-b border-stone-200 bg-stone-900 text-white">
          <div className="flex w-full items-center gap-3 px-4 py-3">
            <Link href="/dev" className="shrink-0 font-medium tracking-tight">
              {t.login.brand} <span className="text-stone-400">· developer</span>
            </Link>
            <span className="flex-1" />
            <span className="hidden text-sm text-stone-300 sm:block">{user.fullName}</span>
            <form action={signOut}>
              <button
                type="submit"
                className="min-h-11 rounded-lg px-3 text-sm text-stone-300 hover:bg-stone-800 hover:text-white"
              >
                {t.common.signOut}
              </button>
            </form>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
      </div>
    )
  }

  const nav = navFor(user.role)

  if (user.role === 'vendor') {
    return (
      <div className="flex min-h-dvh flex-col bg-white text-stone-900">
        {viewAsBanner}
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
      {viewAsBanner}

      <header className="no-print border-b border-stone-200">
        <div className="flex w-full items-center gap-3 px-4 py-3">
          <Link href="/" className="shrink-0 font-medium tracking-tight">
            {t.login.brand}
          </Link>

          <nav className="flex-1 overflow-x-auto">
            <ul className="flex items-center gap-1">
              {nav.top.map((item) => (
                <NavLink key={item.href} href={item.href} label={item.label} />
              ))}
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
        {nav.side.length > 0 && (
          <SidePanel heading={user.fullName} subheading={user.email ?? ''} items={nav.side} />
        )}

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
