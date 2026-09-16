import { LoadingAnnouncement, Skeleton, SkeletonHeader } from '@/components/ui/primitives'

export default function Loading() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <LoadingAnnouncement label="Loading the sarees waiting for a decision" />
      <SkeletonHeader />
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="flex gap-4 rounded-xl border border-stone-200 bg-white p-4">
          <Skeleton className="h-36 w-28 shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-3 w-56" />
            <Skeleton className="h-3 w-48" />
            <Skeleton className="h-11 w-56" />
          </div>
        </div>
      ))}
    </div>
  )
}
