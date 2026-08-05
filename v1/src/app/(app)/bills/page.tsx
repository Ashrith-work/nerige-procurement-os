import Link from 'next/link'
import { listBills } from '@/lib/data/procurement'
import { requireRole } from '@/lib/auth/session'
import {
  Button,
  Card,
  EmptyState,
  PageHeader,
  Stat,
  StatusBadge,
  WorkSection,
} from '@/components/ui/primitives'
import { money, formatDate, daysUntil, dueLabel } from '@/lib/format'
import { BILL_STATUS_META, type BillStatus } from '@/lib/domain/procurement'

export const metadata = { title: 'Bills · Nerige Story' }

interface BillRow {
  id: string
  bill_number: string
  bill_date: string
  due_date: string | null
  status: BillStatus
  total_amount: string
  variance_amount: string | null
  vendors: { display_name: string; msme_category: string } | null
  purchase_orders: { po_number: string } | null
}

/**
 * Every bill, and what it is waiting on.
 *
 * Sorted by due date rather than by when it arrived, because the deadline that
 * matters is statutory: a micro or small MSME supplier paid beyond 45 days
 * disallows the expense for the whole financial year under s.43B(h). That is a
 * tax consequence, not a courtesy, so the ageing list leads.
 */
export default async function BillsPage() {
  await requireRole('founder', 'procurement_head')
  const bills = (await listBills()) as unknown as BillRow[]


  const unsettled = bills.filter((b) => !['paid', 'rejected'].includes(b.status))
  const needsReview = bills.filter((b) => b.status === 'submitted')
  const withVariance = bills.filter(
    (b) => b.status === 'under_review' && Number(b.variance_amount ?? 0) !== 0,
  )
  const awaitingApproval = bills.filter((b) => b.status === 'under_review')
  const approved = bills.filter((b) => b.status === 'approved')
  const dueSoon = unsettled.filter((b) => {
    const days = daysUntil(b.due_date)
    return days !== null && days <= 7
  })

  const outstanding = unsettled.reduce((sum, b) => sum + Number(b.total_amount), 0)

  return (
    <div className="space-y-5">
      <PageHeader
        title="Bills"
        subtitle="What we have been billed, what it was for, and what is due."
      />


      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Outstanding" value={money(outstanding)} hint="Not yet paid" />
        <Stat
          label="To review"
          value={needsReview.length}
          tone={needsReview.length ? 'warn' : 'neutral'}
        />
        <Stat
          label="Awaiting approval"
          value={awaitingApproval.length}
          tone={awaitingApproval.length ? 'warn' : 'neutral'}
        />
        <Stat
          label="Due within 7 days"
          value={dueSoon.length}
          tone={dueSoon.length ? 'bad' : 'good'}
          hint="MSME suppliers must be paid inside 45 days"
        />
      </div>

      <WorkSection
        title="Uploaded, nobody has checked"
        hint="Match each against what was counted in, then approve or query it."
        count={needsReview.length}
      >
        {needsReview.map((b) => (
          <BillRowLink key={b.id} bill={b} />
        ))}
      </WorkSection>

      <WorkSection
        title="Figures do not agree"
        hint="Billed for more or less than was counted in. Query it before it is paid."
        count={withVariance.length}
      >
        {withVariance.map((b) => (
          <BillRowLink key={b.id} bill={b} />
        ))}
      </WorkSection>

      <WorkSection
        title="Approved, waiting to be paid"
        hint="Authorised. Record the payment reference once the transfer is made."
        count={approved.length}
      >
        {approved.map((b) => (
          <BillRowLink key={b.id} bill={b} />
        ))}
      </WorkSection>

      {bills.length === 0 && (
        <EmptyState
          title="No bills yet"
          body="Bills appear here as soon as a vendor uploads one against an order, or when you add one on the order itself. Nothing gets paid that is not attached to an order."
          action={
            <Link href="/purchase-orders">
              <Button variant="secondary">Go to orders</Button>
            </Link>
          }
        />
      )}

      {bills.length > 0 && (
        <Card className="space-y-3">
          <h2 className="text-sm font-semibold">All bills</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="py-2 pr-4 font-medium">Bill</th>
                  <th className="py-2 pr-4 font-medium">Vendor</th>
                  <th className="py-2 pr-4 text-right font-medium">Amount</th>
                  <th className="py-2 pr-4 text-right font-medium">Variance</th>
                  <th className="py-2 pr-4 font-medium">Due</th>
                  <th className="py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {bills.map((b) => {
                  const variance = Number(b.variance_amount ?? 0)
                  const isMsme = ['micro', 'small'].includes(b.vendors?.msme_category ?? '')
                  const days = daysUntil(b.due_date)
                  const urgent = !['paid', 'rejected'].includes(b.status) && days !== null && days <= 7

                  return (
                    <tr key={b.id} className="hover:bg-stone-50">
                      <td className="py-2.5 pr-4">
                        <Link href={`/bills/${b.id}`} className="font-medium hover:underline">
                          {b.bill_number}
                        </Link>
                        <span className="block font-mono text-xs text-stone-400">
                          {b.purchase_orders?.po_number}
                        </span>
                      </td>
                      <td className="py-2.5 pr-4">
                        {b.vendors?.display_name}
                        {isMsme && (
                          <span className="ml-1 text-xs font-medium text-amber-700">MSME</span>
                        )}
                      </td>
                      <td className="py-2.5 pr-4 text-right tabular-nums">
                        {money(b.total_amount)}
                      </td>
                      <td className="py-2.5 pr-4 text-right tabular-nums">
                        {variance === 0 ? (
                          <span className="text-stone-300">—</span>
                        ) : (
                          <span className={variance > 0 ? 'font-medium text-red-700' : 'text-stone-600'}>
                            {variance > 0 ? '+' : ''}
                            {money(variance)}
                          </span>
                        )}
                      </td>
                      <td className={`py-2.5 pr-4 text-xs ${urgent ? 'font-medium text-red-700' : 'text-stone-500'}`}>
                        {b.due_date ? `${formatDate(b.due_date)}` : '—'}
                      </td>
                      <td className="py-2.5">
                        <StatusBadge status={b.status} label={BILL_STATUS_META[b.status]?.label} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}

function BillRowLink({ bill }: { bill: BillRow }) {
  const variance = Number(bill.variance_amount ?? 0)

  return (
    <Link
      href={`/bills/${bill.id}`}
      className="flex flex-wrap items-center justify-between gap-3 py-3 hover:bg-stone-50"
    >
      <div>
        <p className="font-medium">
          {bill.vendors?.display_name}
          <span className="ml-2 font-normal text-stone-500">{bill.bill_number}</span>
        </p>
        <p className="text-xs text-stone-500">
          {bill.purchase_orders?.po_number} · {dueLabel(bill.due_date)}
        </p>
      </div>
      <div className="text-right">
        <p className="font-medium tabular-nums">{money(bill.total_amount)}</p>
        {variance !== 0 && (
          <p className="text-xs font-medium text-red-700">
            {variance > 0 ? 'Billed over by ' : 'Billed under by '}
            {money(Math.abs(variance))}
          </p>
        )}
      </div>
    </Link>
  )
}
