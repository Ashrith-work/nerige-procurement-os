import Link from 'next/link'
import { format } from 'date-fns'
import { requireProcurement } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { LOCALE_NAMES, type Locale } from '@/lib/i18n'
import { toDisplayUserId } from '@/lib/auth/user-id'
import { PageHeader, EmptyState, LinkButton } from '@/components/ui/primitives'

export const metadata = { title: 'Weavers · Nerige' }

/**
 * Every weaver Nerige buys from, on one screen.
 *
 * The columns are the questions actually asked about a vendor, in the order
 * they get asked: who is she, what language does her portal open in, what is
 * her login, how much of the catalogue is hers, is she waiting on anything, and
 * when did she last actually sign in.
 *
 * That last column is the one that earns its place. A weaver who has never
 * signed in has not seen a single order, however many have been issued to her —
 * and nothing else on this screen would show that.
 */
interface VendorRow {
  id: string
  code: string
  display_name: string
  default_locale: string
  status: string
}

export default async function AdminVendorsPage() {
  await requireProcurement()
  const supabase = await createClient()

  // Three reads. The counts come from `vendor_summary`, which counts `products`
  // directly rather than off `vendor_collections` — that view groups by
  // collection and drops rows where it is null, so it would quietly understate
  // any weaver with uncategorised designs.
  const [{ data: vendorRows }, { data: summaryRows }, { data: userRows }] = await Promise.all([
    supabase
      .from('vendors')
      .select('id, code, display_name, default_locale, status')
      .is('deleted_at', null)
      .order('code'),
    supabase.from('vendor_summary').select('vendor_id, design_count, open_order_count'),
    supabase
      .from('vendor_users')
      .select('vendor_id, app_users(email, last_seen_at)')
      .is('deleted_at', null),
  ])

  const vendors = (vendorRows ?? []) as VendorRow[]

  const designs = new Map<string, number>()
  const openOrders = new Map<string, number>()
  for (const row of summaryRows ?? []) {
    designs.set(row.vendor_id, row.design_count ?? 0)
    openOrders.set(row.vendor_id, row.open_order_count ?? 0)
  }

  type Embedded = { email: string | null; last_seen_at: string | null }
  const logins = new Map<string, Embedded>()
  for (const row of userRows ?? []) {
    const raw = row.app_users as Embedded | Embedded[] | null
    const user = Array.isArray(raw) ? raw[0] : raw
    if (!user) continue
    const existing = logins.get(row.vendor_id)
    // The most recently seen login answers "has anyone at this weaver opened it".
    if (!existing || (user.last_seen_at ?? '') > (existing.last_seen_at ?? '')) {
      logins.set(row.vendor_id, user)
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Weavers"
        subtitle={`${vendors.length} weaving houses, their logins and languages`}
        action={
          <div className="flex gap-2">
            <LinkButton href="/admin/products">All designs</LinkButton>
            <LinkButton href="/admin/vendors/new" variant="primary">
              Add a weaver
            </LinkButton>
          </div>
        }
      />

      {vendors.length === 0 ? (
        <EmptyState
          title="No weavers yet"
          body="A weaver appears here as soon as the catalogue syncs a SKU carrying her code. Until then, add the first house by hand."
          action={
            <LinkButton href="/admin/vendors/new" variant="primary">
              Add a weaver
            </LinkButton>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-stone-200">
          <table className="w-full text-sm">
            <caption className="sr-only">
              Every weaving house, with its code, language, login and open orders
            </caption>
            {/*
              * The house comes first, because that is what people say out loud.
              * The code is second and monospace: it is the SKU prefix, read
              * character by character.
              */}
            <thead className="border-b border-stone-200 bg-stone-50 text-left text-stone-600">
              <tr>
                <Th>Weaver</Th>
                <Th>Code</Th>
                <Th>Language</Th>
                <Th>Login</Th>
                <Th className="text-right">Designs</Th>
                <Th className="text-right">Open orders</Th>
                <Th>Last signed in</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {vendors.map((v) => {
                const login = logins.get(v.id)
                return (
                  <tr key={v.id} className="hover:bg-stone-50">
                    <Td>
                      <Link
                        href={`/admin/vendors/${encodeURIComponent(v.code)}`}
                        className="inline-flex min-h-11 items-center font-medium text-stone-900 underline-offset-2 hover:underline"
                      >
                        {v.display_name}
                      </Link>
                    </Td>
                    <Td className="font-mono text-stone-700">{v.code}</Td>
                    <Td>{LOCALE_NAMES[v.default_locale as Locale] ?? v.default_locale}</Td>
                    <Td className="font-mono text-xs text-stone-600">
                      {login?.email ? (toDisplayUserId(login.email) ?? login.email) : 'No login yet'}
                    </Td>
                    <Td className="text-right tabular-nums">
                      {(designs.get(v.id) ?? 0).toLocaleString('en-IN')}
                    </Td>
                    <Td className="text-right tabular-nums">{openOrders.get(v.id) ?? 0}</Td>
                    <Td className="text-stone-600">
                      {login?.last_seen_at ? (
                        format(new Date(login.last_seen_at), 'd MMM yyyy')
                      ) : (
                        // Not "—". A weaver who has never signed in has seen
                        // none of the orders issued to her, and that is worth
                        // saying in words.
                        <span className="font-medium text-amber-800">Never</span>
                      )}
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <th scope="col" className={`px-3 py-2 font-medium whitespace-nowrap ${className}`}>
      {children}
    </th>
  )
}

function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2.5 whitespace-nowrap ${className}`}>{children}</td>
}
