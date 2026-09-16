import { LoadingAnnouncement, Skeleton, SkeletonHeader } from '@/components/ui/primitives'

export default function Loading() {
  return (
    <div className="max-w-3xl space-y-6">
      <LoadingAnnouncement label="Loading the sarees with no weaver" />
      <SkeletonHeader />
      <div className="rounded border border-stone-200 bg-white px-4">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex gap-4 border-b border-stone-200 py-4 last:border-b-0">
            <Skeleton className="h-28 w-24 shrink-0" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-56" />
              <Skeleton className="h-11 w-64" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
