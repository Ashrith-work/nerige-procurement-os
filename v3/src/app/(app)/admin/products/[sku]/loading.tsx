import { LoadingAnnouncement, Skeleton, SkeletonHeader } from '@/components/ui/primitives'

export default function Loading() {
  return (
    <div className="max-w-4xl space-y-5">
      <LoadingAnnouncement label="Loading this design" />
      <SkeletonHeader />
      <Skeleton className="h-72 w-full" />
      <div className="grid gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-16" />
        ))}
      </div>
      <Skeleton className="h-48 w-full" />
    </div>
  )
}
