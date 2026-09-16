import { LoadingAnnouncement, SkeletonHeader, SkeletonRows } from '@/components/ui/primitives'

export default function Loading() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <LoadingAnnouncement label="Loading your orders" />
      <SkeletonHeader />
      <SkeletonRows rows={6} />
    </div>
  )
}
