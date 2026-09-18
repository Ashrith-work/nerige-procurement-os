import Link from 'next/link'
import { requireUser, type AppRole } from '@/lib/auth/session'
import { getDictionary } from '@/lib/i18n'
import { LanguagePicker } from '@/components/language-picker'
import { SidePanel } from '@/components/admin/side-panel'
import { NavLink } from '@/components/nav-link'
import { ImpersonationBanner } from '@/components/admin/impersonation-banner'
import { readImpersonation } from '@/lib/auth/impersonation'
import { ViewAsBanner } from '@/components/dev/view-as-banner'
import { getWorkspaceContext } from '@/lib/workspaces.server'
import { WorkspaceSwitcher } from '@/components/workspace-switcher'
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

  // The workspace decides what is in front of this person; the role still
  // decides what they may reach. See src/lib/workspaces.ts.
  const { workspaces, active } = await getWorkspaceContext(user)
  const switcherItems = workspaces.map((w) => ({
    key: w.key,
    name: w.name,
    blurb: w.blurb,
    home: w.sections[0]?.href ?? '/dashboard',
    isActive: w.key === active?.key,
  }))

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

          {/* The workspace's own sections, in the order the job runs in. Four
              or five destinations, not fourteen. */}
          <nav className="flex-1 overflow-x-auto" aria-label={active?.name ?? 'Sections'}>
            <ul className="flex items-center gap-1">
              {(active?.sections ?? []).slice(0, 5).map((item) => (
                <NavLink key={item.key} href={item.href} label={item.label} />
              ))}
            </ul>
          </nav>

          <div className="flex shrink-0 items-center gap-2">
            <WorkspaceSwitcher
              workspaces={switcherItems}
              active={switcherItems.find((w) => w.isActive) ?? null}
            />
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
        {/* Everything else this workspace holds. The header carries the first
            five; the panel carries the rest, so neither is a wall.
            "All screens" is always last, whatever the workspace: a shorter menu
            is only an improvement while the long one is still somewhere, and it
            is the answer to "where has Insights gone". */}
        {active && (
          <SidePanel
            heading={active.name}
            subheading={user.fullName}
            items={[
              ...active.sections.slice(5).map((s) => ({ href: s.href, label: s.label })),
              { href: '/all', label: 'All screens' },
            ]}
          />
        )}

        <main className="w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
      </div>
    </div>
  )
}


export type { AppRole }
