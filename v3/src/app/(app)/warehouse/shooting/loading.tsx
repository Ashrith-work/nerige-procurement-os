import { LoadingAnnouncement, Skeleton, SkeletonHeader } from '@/components/ui/primitives'

export default function Loading() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <LoadingAnnouncement label="Loading the shooting board" />
      <SkeletonHeader />
      {Array.from({ length: 3 }, (_, i) => (
        <Skeleton key={i} className="h-40 w-full" />
      ))}
    </div>
  )
}
