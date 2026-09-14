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
        subtitle="Ask for more of anything, and for new designs like it, then confirm."
      />
      <Review />
    </div>
  )
}
