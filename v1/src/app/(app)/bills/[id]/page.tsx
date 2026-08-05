import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getBill } from '@/lib/data/procurement'
import { requireRole } from '@/lib/auth/session'
import {
  Alert,
  Button,
  Card,
  Input,
  PageHeader,
  StatusBadge,
  Textarea,
} from '@/components/ui/primitives'
import {
  startBillReview,
  disputeBill,
  rejectBill,
  approveBill,
  markBillPaid,
  billDocumentUrl,
} from '../actions'
import { money, moneyExact, formatDate, formatDateTime, dueLabel, daysUntil } from '@/lib/format'
import { BILL_STATUS_META, canApproveBills, type BillStatus } from '@/lib/domain/procurement'

interface BillDetail {
  id: string
  bill_number: string
  bill_date: string
  due_date: string | null
  status: BillStatus
  subtotal_amount: string
  tax_amount: string
  total_amount: string
  matched_received_value: string | null
  variance_amount: string | null
  variance_note: string | null
  payment_reference: string | null
  reviewed_at: string | null
  approved_at: string | null
  paid_at: string | null
  document_id: string
  purchase_order_id: string
  vendors: {
    display_name: string
    msme_category: string
    payment_terms_days: number
  } | null
  purchase_orders: { po_number: string; total_amount: string } | null
}

export const metadata = { title: 'Bill · Nerige Story' }

/**
 * One bill, with the three numbers that decide whether to pay it side by side:
 * what was ORDERED, what was RECEIVED, and what is being BILLED.
 *
 * Presenting them together is the entire control. Each on its own screen is how
 * a bill for goods that never arrived gets paid — nobody is lying, the numbers
 * simply never met.
 */
export default async function BillPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ error?: string }>
}) {
  const user = await requireRole('founder', 'procurement_head')
  const { id } = await params
  const { error: errorMessage } = await searchParams
  const data = await getBill(id)

  if (!data) notFound()
  const bill = data as unknown as BillDetail

  const documentUrl = await billDocumentUrl(bill.document_id)
  const variance = Number(bill.variance_amount ?? 0)
  const isMsme = ['micro', 'small'].includes(bill.vendors?.msme_category ?? '')
  const days = daysUntil(bill.due_date)
  const settled = ['paid', 'rejected'].includes(bill.status)

  return (
    <div className="space-y-5">
      <PageHeader
        title={bill.vendors?.display_name ?? 'Bill'}
        subtitle={`Bill ${bill.bill_number} · ${formatDate(bill.bill_date)}`}
        action={
          <div className="flex items-center gap-2">
            <StatusBadge status={bill.status} label={BILL_STATUS_META[bill.status].label} />
            <Link href="/bills" className="text-sm text-stone-500 hover:text-stone-900">
              All bills
            </Link>
          </div>
        }
      />

      {errorMessage && <Alert tone="error">{errorMessage}</Alert>}

      {isMsme && !settled && (
        <Alert tone={days !== null && days <= 7 ? 'error' : 'info'}>
          {bill.vendors?.msme_category === 'micro' ? 'Micro' : 'Small'} MSME supplier —{' '}
          {dueLabel(bill.due_date)}. Paying beyond {bill.vendors?.payment_terms_days} days
          disallows this expense for the financial year under Income Tax Act s.43B(h).
        </Alert>
      )}

      {/* The three-way match, as three numbers on one line. */}
      <div className="grid gap-3 sm:grid-cols-3">
        <MatchFigure
          label="Ordered"
          value={money(bill.purchase_orders?.total_amount)}
          hint={bill.purchase_orders?.po_number}
        />
        <MatchFigure
          label="Counted in"
          value={money(bill.matched_received_value)}
          hint="Good pieces only — damaged excluded"
        />
        <MatchFigure
          label="Billed"
          value={money(bill.total_amount)}
          hint={variance === 0 ? 'Matches what arrived' : undefined}
          tone={variance > 0 ? 'bad' : variance < 0 ? 'warn' : 'good'}
        />
      </div>

      {variance !== 0 && (
        <Alert tone={variance > 0 ? 'error' : 'info'}>
          {variance > 0 ? (
            <>
              Billed <strong>{money(variance)}</strong> more than the value of what was counted in.
              That is either a short delivery, damaged pieces billed in full, or a rate that does
              not match the order.
            </>
          ) : (
            <>
              Billed <strong>{money(Math.abs(variance))}</strong> less than the value counted in — a
              further bill for the balance is probably coming.
            </>
          )}
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-3">
          <h2 className="text-sm font-semibold">The bill</h2>
          <dl className="space-y-2 text-sm">
            <Row label="Before GST" value={moneyExact(bill.subtotal_amount)} />
            <Row label="GST" value={moneyExact(bill.tax_amount)} />
            <Row label="Total" value={moneyExact(bill.total_amount)} />
            <Row label="Bill date" value={formatDate(bill.bill_date)} />
            <Row label="Payable by" value={formatDate(bill.due_date)} />
            <Row label="Reviewed" value={formatDateTime(bill.reviewed_at)} />
            <Row label="Approved" value={formatDateTime(bill.approved_at)} />
            <Row label="Paid" value={formatDateTime(bill.paid_at)} />
            {bill.payment_reference && <Row label="Reference" value={bill.payment_reference} />}
          </dl>
          {bill.variance_note && (
            <div className="rounded-lg bg-amber-50 px-3 py-2">
              <p className="text-xs font-medium text-amber-800">Query raised</p>
              <p className="mt-1 text-sm text-amber-900">{bill.variance_note}</p>
            </div>
          )}
          <Link
            href={`/purchase-orders/${bill.purchase_order_id}`}
            className="inline-block text-sm text-stone-600 underline"
          >
            Open the order
          </Link>
        </Card>

        <Card className="space-y-3">
          <h2 className="text-sm font-semibold">The hard copy</h2>
          {documentUrl ? (
            <>
              {/* Rendered as a link rather than an inline preview: the file may
                  be a PDF or a 12 MB phone photo, and a signed URL expires. */}
              <a
                href={documentUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-11 items-center rounded-lg border border-stone-300 px-4 text-sm font-medium hover:bg-stone-50"
              >
                Open the bill
              </a>
              <p className="text-xs text-stone-500">
                Private link, valid for five minutes. The file is never publicly reachable.
              </p>
            </>
          ) : (
            <p className="text-sm text-stone-500">The attached file could not be loaded.</p>
          )}
        </Card>
      </div>

      {!settled && (
        <Card className="space-y-4">
          <h2 className="text-sm font-semibold">What happens next</h2>

          {bill.status === 'submitted' && (
            <div className="flex flex-wrap items-center gap-3">
              <form action={startBillReview}>
                <input type="hidden" name="bill_id" value={bill.id} />
                <Button type="submit">Start review</Button>
              </form>
              <p className="text-sm text-stone-500">
                Check it against what was counted in. The vendor can no longer edit the figures
                once you begin.
              </p>
            </div>
          )}

          {bill.status === 'under_review' && (
            <div className="space-y-4">
              {canApproveBills(user.role) ? (
                <form action={approveBill} className="flex flex-wrap items-center gap-3">
                  <input type="hidden" name="bill_id" value={bill.id} />
                  <Button type="submit">Approve for payment</Button>
                  <span className="text-sm text-stone-500">
                    {variance === 0
                      ? 'The figures agree.'
                      : 'The figures do not agree — approve only if you are satisfied with why.'}
                  </span>
                </form>
              ) : (
                <Alert tone="info">
                  Only the Founder can approve a bill for payment. This one is ready for them.
                </Alert>
              )}

              <form action={disputeBill} className="flex flex-wrap gap-2">
                <input type="hidden" name="bill_id" value={bill.id} />
                <Input
                  name="variance_note"
                  required
                  maxLength={1000}
                  placeholder="What does not agree? The vendor is told."
                  className="max-w-md"
                />
                <Button type="submit" variant="secondary">
                  Query with vendor
                </Button>
              </form>
            </div>
          )}

          {bill.status === 'disputed' && (
            <form action={startBillReview} className="flex flex-wrap items-center gap-3">
              <input type="hidden" name="bill_id" value={bill.id} />
              <Button type="submit" variant="secondary">
                Reopen review
              </Button>
              <span className="text-sm text-stone-500">Once the vendor has come back on it.</span>
            </form>
          )}

          {bill.status === 'approved' && (
            <>
              {canApproveBills(user.role) ? (
                <form action={markBillPaid} className="flex flex-wrap gap-2">
                  <input type="hidden" name="bill_id" value={bill.id} />
                  <Input
                    name="payment_reference"
                    required
                    maxLength={100}
                    placeholder="NEFT / UTR reference"
                    className="max-w-xs"
                  />
                  <Button type="submit">Mark paid</Button>
                </form>
              ) : (
                <Alert tone="info">Approved. The Founder records the payment.</Alert>
              )}
              <p className="text-xs text-stone-500">
                Recording payment closes the order it belongs to.
              </p>
            </>
          )}

          {['submitted', 'under_review', 'disputed'].includes(bill.status) && (
            <form action={rejectBill} className="flex flex-wrap gap-2 border-t border-stone-100 pt-4">
              <input type="hidden" name="bill_id" value={bill.id} />
              <Textarea
                name="variance_note"
                required
                rows={1}
                maxLength={1000}
                placeholder="Why is this being rejected?"
                className="max-w-md"
              />
              <Button type="submit" variant="danger">
                Reject
              </Button>
            </form>
          )}
        </Card>
      )}
    </div>
  )
}

function MatchFigure({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string
  value: string
  hint?: string
  tone?: 'neutral' | 'good' | 'warn' | 'bad'
}) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4">
      <p className="text-xs uppercase tracking-wide text-stone-500">{label}</p>
      <p
        className={`mt-1 text-xl font-semibold tabular-nums ${
          tone === 'bad' ? 'text-red-700' : tone === 'warn' ? 'text-amber-700' : tone === 'good' ? 'text-emerald-700' : ''
        }`}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-stone-500">{hint}</p>}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-stone-500">{label}</dt>
      <dd className="text-right font-medium tabular-nums">{value}</dd>
    </div>
  )
}
