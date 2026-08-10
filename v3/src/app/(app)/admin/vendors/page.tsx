import Link from 'next/link'
import { format } from 'date-fns'
import { requireProcurement } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { LOCALE_NAMES, type Locale } from '@/lib/i18n'
import { toDisplayUserId } from '@/lib/auth/user-id'
import { PageHeader, Button, EmptyState } from '@/components/ui/primitives'

export const metadata = { title: 'My vendors · Nerige' }

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
        title="My vendors"
        subtitle={`${vendors.length} weavers`}
        action={
          <div className="flex gap-2">
            <Link href="/admin/products">
              <Button variant="secondary">All products</Button>
            </Link>
            <Link href="/admin/vendors/new">
              <Button>Add a vendor</Button>
            </Link>
          </div>
        }
      />

      {vendors.length === 0 ? (
        <EmptyState title="No vendors yet" body="Add one, or load the catalogue to derive them from SKU prefixes." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-stone-200">
          <table className="w-full text-sm">
            <thead className="border-b border-stone-200 bg-stone-50 text-left text-stone-500">
              <tr>
                <Th>Code</Th>
                <Th>Name</Th>
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
                        className="font-mono font-medium text-stone-900 underline-offset-2 hover:underline"
                      >
                        {v.code}
                      </Link>
                    </Td>
                    <Td>{v.display_name}</Td>
                    <Td>{LOCALE_NAMES[v.default_locale as Locale] ?? v.default_locale}</Td>
                    <Td className="font-mono text-xs text-stone-600">
                      {login?.email ? (toDisplayUserId(login.email) ?? login.email) : '—'}
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
                        <span className="text-amber-700">Never</span>
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
  return <th className={`px-3 py-2 font-medium whitespace-nowrap ${className}`}>{children}</th>
}

function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2.5 whitespace-nowrap ${className}`}>{children}</td>
}
