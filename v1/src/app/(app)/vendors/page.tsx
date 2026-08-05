import Link from 'next/link'
import { listVendors } from '@/lib/data/vendors'
import { requireUser, canManageVendors } from '@/lib/auth/session'
import { Button, Card, StatusBadge, EmptyState, Input } from '@/components/ui/primitives'

export const metadata = { title: 'Vendors · Nerige Story' }

export default async function VendorsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>
}) {
  const user = await requireUser()
  const { q, status } = await searchParams
  const { vendors, error } = await listVendors({ q, status })

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Vendors</h1>
          <p className="text-sm text-stone-500">
            {vendors.length} {vendors.length === 1 ? 'vendor' : 'vendors'}
          </p>
        </div>
        {canManageVendors(user.role) && (
          <Link href="/vendors/new">
            <Button>Add vendor</Button>
          </Link>
        )}
      </div>

      <form className="flex flex-wrap gap-2">
        <Input
          name="q"
          defaultValue={q ?? ''}
          placeholder="Search by name or code…"
          className="max-w-xs"
          aria-label="Search vendors"
        />
        <select
          name="status"
          defaultValue={status ?? ''}
          aria-label="Filter by status"
          className="min-h-11 rounded-lg border border-stone-300 bg-white px-3 text-sm"
        >
          <option value="">All statuses</option>
          {['draft', 'pending_kyc', 'active', 'on_hold', 'blacklisted', 'archived'].map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
        <Button type="submit" variant="secondary">
          Filter
        </Button>
      </form>

      {error && (
        <Card className="border-red-200 bg-red-50 text-sm text-red-800">
          Could not load vendors: {error}
        </Card>
      )}

      {!error && vendors.length === 0 && (
        <EmptyState
          title={q || status ? 'No vendors match that filter' : 'No vendors yet'}
          body={
            q || status
              ? 'Try a different name, code or status.'
              : 'Add your first vendor to start moving procurement off WhatsApp and spreadsheets.'
          }
          action={
            canManageVendors(user.role) && !q && !status ? (
              <Link href="/vendors/new">
                <Button>Add vendor</Button>
              </Link>
            ) : undefined
          }
        />
      )}

      {vendors.length > 0 && (
        <>
          {/* Cards on phones, table on desktop. A horizontally scrolling table
              on a handset is the fastest way to make a system feel unusable. */}
          <div className="grid gap-3 sm:hidden">
            {vendors.map((v) => (
              <Link key={v.id} href={`/vendors/${v.id}`}>
                <Card className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">{v.display_name}</p>
                      <p className="font-mono text-xs text-stone-500">{v.code}</p>
                    </div>
                    <StatusBadge status={v.status} />
                  </div>
                  <dl className="flex gap-4 text-xs text-stone-500">
                    <div>
                      <dt className="inline">Lead time </dt>
                      <dd className="inline font-medium text-stone-700">
                        {v.default_lead_time_days}d
                      </dd>
                    </div>
                    <div>
                      <dt className="inline">Terms </dt>
                      <dd className="inline font-medium text-stone-700">
                        {v.payment_terms_days}d
                      </dd>
                    </div>
                  </dl>
                </Card>
              </Link>
            ))}
          </div>

          <div className="hidden overflow-hidden rounded-xl border border-stone-200 bg-white sm:block">
            <table className="w-full text-sm">
              <thead className="border-b border-stone-200 bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Vendor</th>
                  <th className="px-4 py-2 font-medium">Code</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">GSTIN</th>
                  <th className="px-4 py-2 font-medium">MSME</th>
                  <th className="px-4 py-2 text-right font-medium">Lead time</th>
                  <th className="px-4 py-2 text-right font-medium">Terms</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {vendors.map((v) => (
                  <tr key={v.id} className="hover:bg-stone-50">
                    <td className="px-4 py-2.5">
                      <Link href={`/vendors/${v.id}`} className="font-medium hover:underline">
                        {v.display_name}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-stone-500">{v.code}</td>
                    <td className="px-4 py-2.5">
                      <StatusBadge status={v.status} />
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-stone-500">
                      {v.gstin ?? '—'}
                    </td>
                    <td className="px-4 py-2.5 text-xs">
                      {v.msme_category === 'not_registered' ? (
                        <span className="text-stone-400">—</span>
                      ) : (
                        // Surfaced in the list, not buried in the detail page:
                        // the 45-day clock is what creates tax exposure, and
                        // it needs to be visible while planning, not after.
                        <span className="font-medium text-amber-700">{v.msme_category}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {v.default_lead_time_days}d
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{v.payment_terms_days}d</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
