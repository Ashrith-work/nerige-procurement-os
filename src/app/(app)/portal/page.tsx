import { requireRole } from '@/lib/auth/session'
import { Card, EmptyState } from '@/components/ui/primitives'

export const metadata = { title: 'My orders · Nerige Story' }

/**
 * Vendor portal placeholder.
 *
 * M1 delivers the identity and isolation foundation; the working portal —
 * accepting POs, production status, dispatch details, invoice upload — is M4.
 * This page exists so a vendor account can be provisioned and tested end to end
 * now, and so the isolation model is exercised by a real session rather than
 * only by the test suite.
 */
export default async function PortalPage() {
  const user = await requireRole('vendor')

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">{user.vendorName}</h1>
        <p className="text-sm text-stone-500">Signed in as {user.fullName}</p>
      </div>

      <EmptyState
        title="No purchase orders yet"
        body="When Nerige Story sends you a purchase order, it will appear here and you will get an SMS. You will be able to accept it, update production status, and upload your invoice."
      />

      <Card className="space-y-1">
        <h2 className="text-sm font-semibold">Your details</h2>
        <p className="text-sm text-stone-500">
          If your mobile number or bank details change, contact the procurement team — for your
          security these cannot be changed here.
        </p>
      </Card>
    </div>
  )
}
