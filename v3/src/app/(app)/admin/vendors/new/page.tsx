import { requireProcurement } from '@/lib/auth/session'
import { PageHeader } from '@/components/ui/primitives'
import { NewVendorForm } from './new-vendor-form'

export const metadata = { title: 'Add a weaver' }

export default async function NewVendorPage() {
  await requireProcurement()
  return (
    <div className="max-w-xl space-y-5">
      <PageHeader
        title="Add a weaver"
        subtitle="Creates the house, her first login and her password in one step."
      />
      <NewVendorForm />
    </div>
  )
}
