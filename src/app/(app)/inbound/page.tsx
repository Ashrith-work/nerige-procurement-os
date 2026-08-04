import { requireRole } from '@/lib/auth/session'
import { EmptyState } from '@/components/ui/primitives'

export const metadata = { title: 'Inbound · Nerige Story' }

/**
 * Warehouse landing page.
 *
 * Intentionally empty in M1. The shape of receiving depends on the M0 spike —
 * whether goods receipt happens here or in EasyEcom/Increff. Building a
 * receiving UI before that question is answered would risk duplicating a
 * workflow the warehouse already has.
 */
export default async function InboundPage() {
  await requireRole('founder', 'warehouse_manager')

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <h1 className="text-lg font-semibold tracking-tight">Inbound</h1>
      <EmptyState
        title="Nothing expected yet"
        body="Incoming shipments will appear here once purchase orders are live. Whether receiving happens in this system or in the existing WMS is decided by the M0 warehouse audit."
      />
    </div>
  )
}
