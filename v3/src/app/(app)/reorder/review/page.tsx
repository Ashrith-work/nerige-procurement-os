import { requireProcurement } from '@/lib/auth/session'
import { PageHeader } from '@/components/ui/primitives'
import { Review } from './review'

export const metadata = { title: 'Review · Nerige' }

export default async function ReviewPage() {
  await requireProcurement()

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader
        title="Before you send"
        subtitle="Move anything from restock into a new design, then confirm."
      />
      <Review />
    </div>
  )
}
