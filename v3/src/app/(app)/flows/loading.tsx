import { LoadingAnnouncement, Skeleton, SkeletonRows } from '@/components/ui/primitives'

/** Every flow step: the progress bar, then whatever that step is made of. */
export default function Loading() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <LoadingAnnouncement label="Loading this step" />
      <Skeleton className="h-12 w-full" />
      <SkeletonRows rows={5} />
    </div>
  )
}
