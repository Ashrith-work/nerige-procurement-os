import { LoadingAnnouncement, Skeleton, SkeletonHeader, SkeletonRows } from '@/components/ui/primitives'

export default function Loading() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <LoadingAnnouncement label="Loading the saree words" />
      <SkeletonHeader />
      <div className="flex gap-1 overflow-hidden">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-11 w-28 shrink-0 rounded-full" />
        ))}
      </div>
      <SkeletonRows rows={6} />
    </div>
  )
}
