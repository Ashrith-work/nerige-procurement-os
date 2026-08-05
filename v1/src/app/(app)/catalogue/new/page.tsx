import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth/session'
import { Button, EmptyState, PageHeader } from '@/components/ui/primitives'
import { ProductForm } from './product-form'

export const metadata = { title: 'Add a SKU · Nerige Story' }

export default async function NewProductPage({
  searchParams,
}: {
  searchParams: Promise<{ vendor?: string }>
}) {
  await requireRole('founder', 'procurement_head')
  const { vendor } = await searchParams
  const supabase = await createClient()

  const [{ data: vendors }, { data: series }] = await Promise.all([
    supabase
      .from('vendors')
      .select('id, display_name, code')
      .in('status', ['active', 'pending_kyc', 'on_hold'])
      .is('deleted_at', null)
      .order('display_name'),
    supabase
      .from('product_series')
      .select('id, name, code, vendor_id')
      .is('deleted_at', null)
      .order('name'),
  ])

  if (!vendors?.length) {
    return (
      <div className="mx-auto max-w-2xl space-y-5">
        <PageHeader title="Add a SKU" />
        <EmptyState
          title="No vendors yet"
          body="A SKU belongs to the vendor who weaves it, so add a vendor first."
          action={
            <Link href="/vendors/new">
              <Button>Add a vendor</Button>
            </Link>
          }
        />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader
        title="Add a SKU"
        subtitle="The code here is what the vendor prints on the label and the warehouse reads at inward."
        action={
          <Link href="/catalogue" className="text-sm text-stone-500 hover:text-stone-900">
            Catalogue
          </Link>
        }
      />
      <ProductForm vendors={vendors} series={series ?? []} defaultVendorId={vendor} />
    </div>
  )
}
