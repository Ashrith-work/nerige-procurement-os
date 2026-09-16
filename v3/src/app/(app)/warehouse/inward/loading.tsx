import { LoadingAnnouncement, SkeletonHeader, SkeletonRows } from '@/components/ui/primitives'

export default function Loading() {
  return (
    <div className="max-w-4xl space-y-8">
      <LoadingAnnouncement label="Loading the parcels" />
      <SkeletonHeader />
      <SkeletonRows rows={4} />
      <SkeletonRows rows={3} />
    </div>
  )
}
