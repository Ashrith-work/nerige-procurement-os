import Link from 'next/link'
import { requireRole } from '@/lib/auth/session'
import { VendorForm } from './vendor-form'

export const metadata = { title: 'Add vendor · Nerige Story' }

export default async function NewVendorPage() {
  // Warehouse Managers can read vendors but not create them. RLS enforces this;
  // the redirect just avoids showing a form that would fail on submit.
  await requireRole('founder', 'procurement_head')

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <Link href="/vendors" className="text-sm text-stone-500 hover:underline">
          ← Vendors
        </Link>
        <h1 className="mt-1 text-lg font-semibold tracking-tight">Add vendor</h1>
      </div>
      <VendorForm />
    </div>
  )
}
