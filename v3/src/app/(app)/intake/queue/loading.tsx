import { LoadingAnnouncement, Skeleton, SkeletonHeader, SkeletonRows } from '@/components/ui/primitives'

export default function Loading() {
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <LoadingAnnouncement label="Loading the sarees being added" />
      <SkeletonHeader />
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-11 w-28 rounded-full" />
        ))}
      </div>
      <SkeletonRows rows={8} />
    </div>
  )
}
