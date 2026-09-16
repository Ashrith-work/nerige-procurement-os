import { LoadingAnnouncement, SkeletonHeader, SkeletonRows } from '@/components/ui/primitives'

export default function Loading() {
  return (
    <div className="space-y-5">
      <LoadingAnnouncement label="Loading the weavers" />
      <SkeletonHeader />
      <SkeletonRows rows={8} />
    </div>
  )
}
