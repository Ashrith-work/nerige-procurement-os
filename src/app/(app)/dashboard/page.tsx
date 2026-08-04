import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth/session'
import { Card, Button } from '@/components/ui/primitives'

export const metadata = { title: 'Dashboard · Nerige Story' }

/**
 * M1 dashboard: vendor-master health only.
 *
 * Deliberately not the Founder dashboard from the brief (pending / delayed /
 * cash committed / upcoming deliveries). Those need purchase orders, receipts
 * and invoices to exist — M3, M5 and M6. Rendering them now would mean showing
 * zeroes or fabricated numbers, and a dashboard that has ever lied is one
 * nobody checks again. It ships in M7, on real data.
 */
export default async function DashboardPage() {
  await requireRole('founder', 'procurement_head')
  const supabase = await createClient()

  const { data: vendors } = await supabase
    .from('vendors')
    .select('id, status, msme_category, display_name, created_at')
    .is('deleted_at', null)

  const total = vendors?.length ?? 0
  const byStatus = (s: string) => vendors?.filter((v) => v.status === s).length ?? 0
  const msmeCount =
    vendors?.filter((v) => v.msme_category === 'micro' || v.msme_category === 'small').length ?? 0

  const blockers = vendors?.filter((v) => v.status === 'pending_kyc') ?? []

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-stone-500">Vendor master health</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Vendors', value: total, tone: '' },
          { label: 'Active', value: byStatus('active'), tone: 'text-emerald-700' },
          { label: 'Pending KYC', value: byStatus('pending_kyc'), tone: 'text-amber-700' },
          { label: 'MSME (45-day)', value: msmeCount, tone: 'text-amber-700' },
        ].map((stat) => (
          <Card key={stat.label}>
            <p className="text-xs uppercase tracking-wide text-stone-500">{stat.label}</p>
            <p className={`mt-1 text-2xl font-semibold tabular-nums ${stat.tone}`}>{stat.value}</p>
          </Card>
        ))}
      </div>

      {blockers.length > 0 && (
        <Card className="space-y-3">
          <h2 className="text-sm font-semibold">Blocked from ordering</h2>
          <p className="text-sm text-stone-500">
            These vendors cannot receive a purchase order until KYC is complete.
          </p>
          <ul className="divide-y divide-stone-100">
            {blockers.map((v) => (
              <li key={v.id} className="py-2">
                <Link href={`/vendors/${v.id}`} className="text-sm font-medium hover:underline">
                  {v.display_name}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="space-y-2 border-dashed bg-transparent shadow-none">
        <h2 className="text-sm font-semibold">Coming next</h2>
        <p className="text-sm text-stone-500">
          Purchase orders, delivery tracking, invoice matching and vendor scorecards arrive in later
          milestones. This dashboard stays deliberately narrow until there is real procurement data
          behind it.
        </p>
        <div>
          <Link href="/vendors">
            <Button variant="secondary">Manage vendors</Button>
          </Link>
        </div>
      </Card>
    </div>
  )
}
