import Link from 'next/link'
import { listOrders, type OrderScope } from '@/lib/data/procurement'
import { requireUser } from '@/lib/auth/session'
import { Button, EmptyState, PageHeader, StatusBadge } from '@/components/ui/primitives'
import { money, formatDate, dueLabel, daysUntil } from '@/lib/format'
import {
  OPEN_PO_STATUSES,
  PO_STATUS_META,
  canManageOrders,
  type PoStatus,
} from '@/lib/domain/procurement'

export const metadata = { title: 'Purchase orders · Nerige Story' }

interface OrderRow {
  id: string
  po_number: string
  status: PoStatus
  title: string | null
  required_by: string | null
  promised_date: string | null
  total_amount: string
  issued_at: string | null
  vendors: { display_name: string; code: string } | null
}

const FILTERS = [
  { key: 'open', label: 'Open' },
  { key: 'waiting', label: 'Waiting on vendor' },
  { key: 'late', label: 'Late' },
  { key: 'draft', label: 'Drafts' },
  { key: 'all', label: 'All' },
] as const

export default async function PurchaseOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; vendor?: string }>
}) {
  const user = await requireUser()
  const { filter = 'open', vendor } = await searchParams

  const orders = (await listOrders(filter as OrderScope, {
    vendorFilter: vendor,
  })) as unknown as OrderRow[]

  return (
    <div className="space-y-5">
      <PageHeader
        title="Purchase orders"
        subtitle="Everything ordered, and whose move it is."
        action={
          canManageOrders(user.role) ? (
            <Link href="/purchase-orders/new">
              <Button>New order</Button>
            </Link>
          ) : undefined
        }
      />

      <nav className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => {
          const active = filter === f.key
          return (
            <Link
              key={f.key}
              href={`/purchase-orders?filter=${f.key}${vendor ? `&vendor=${vendor}` : ''}`}
              className={
                active
                  ? 'rounded-lg bg-stone-900 px-3 py-1.5 text-sm font-medium text-white'
                  : 'rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-sm text-stone-600 hover:bg-stone-50'
              }
            >
              {f.label}
            </Link>
          )
        })}
      </nav>

      {orders.length === 0 && (
        <EmptyState
          title={filter === 'open' ? 'Nothing open' : 'No orders match that filter'}
          body={
            filter === 'open'
              ? 'Every order has been received and settled. Start the next week here.'
              : 'Try another filter.'
          }
          action={
            canManageOrders(user.role) ? (
              <Link href="/purchase-orders/new">
                <Button>New order</Button>
              </Link>
            ) : undefined
          }
        />
      )}

      {orders.length > 0 && (
        <ul className="space-y-2">
          {orders.map((po) => {
            const late =
              OPEN_PO_STATUSES.includes(po.status) && (daysUntil(po.required_by) ?? 1) < 0
            const meta = PO_STATUS_META[po.status]

            return (
              <li key={po.id}>
                <Link
                  href={`/purchase-orders/${po.id}`}
                  className="block rounded-xl border border-stone-200 bg-white p-4 shadow-sm transition-colors hover:border-stone-300 hover:bg-stone-50"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">
                          {po.vendors?.display_name ?? 'Unknown vendor'}
                        </span>
                        <StatusBadge status={po.status} label={meta.label} />
                        {late && (
                          <span className="text-xs font-medium text-red-700">
                            {dueLabel(po.required_by)}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-sm text-stone-500">
                        <span className="font-mono text-xs">{po.po_number}</span>
                        {po.title ? ` · ${po.title}` : ''}
                      </p>
                    </div>

                    <div className="text-right">
                      <p className="font-medium tabular-nums">{money(po.total_amount)}</p>
                      <p className="text-xs text-stone-500">
                        {po.required_by ? `Needed ${formatDate(po.required_by)}` : 'No date set'}
                      </p>
                    </div>
                  </div>

                  {/* The line that turns a status into an instruction. */}
                  <p className="mt-2 text-xs text-stone-500">{meta.hint}</p>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
