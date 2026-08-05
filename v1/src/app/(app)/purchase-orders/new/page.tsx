import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth/session'
import { EmptyState, Button, PageHeader } from '@/components/ui/primitives'
import { NewOrderForm } from './order-form'

export const metadata = { title: 'New order · Nerige Story' }

export default async function NewPurchaseOrderPage() {
  await requireRole('founder', 'procurement_head')
  const supabase = await createClient()

  // Only active vendors. An order to a vendor mid-KYC cannot legally be paid,
  // so it is not offered — a disabled option someone has to ask about is worse
  // than an option that is simply not there.
  const { data: vendors } = await supabase
    .from('vendors')
    .select('id, display_name, code, default_lead_time_days')
    .eq('status', 'active')
    .is('deleted_at', null)
    .order('display_name')

  if (!vendors?.length) {
    return (
      <div className="mx-auto max-w-2xl space-y-5">
        <PageHeader title="New order" />
        <EmptyState
          title="No vendor is ready to receive an order"
          body="A vendor has to be active — KYC complete, bank details on file — before an order can go out. Finish onboarding one first."
          action={
            <Link href="/vendors">
              <Button>Go to vendors</Button>
            </Link>
          }
        />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader
        title="New order"
        subtitle="Start the order, then add what you need on the next screen."
      />
      <NewOrderForm vendors={vendors} />
    </div>
  )
}
