import { LoadingAnnouncement, Skeleton, SkeletonHeader } from '@/components/ui/primitives'

export default function Loading() {
  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <LoadingAnnouncement label="Loading the warehouse" />
      <SkeletonHeader />
      <Skeleton className="h-28 w-full" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
    </div>
  )
}
