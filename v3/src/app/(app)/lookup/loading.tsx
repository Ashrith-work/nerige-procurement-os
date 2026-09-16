import { LoadingAnnouncement, Skeleton, SkeletonHeader, SkeletonRows } from '@/components/ui/primitives'

/**
 * Support is on the phone to a customer while this runs. A blank screen is the
 * moment they say "sorry, it's being slow" — a shape that is obviously the
 * answer arriving is not.
 */
export default function Loading() {
  return (
    <div className="max-w-3xl space-y-6">
      <LoadingAnnouncement label="Searching" />
      <SkeletonHeader />
      <Skeleton className="h-11 w-full" />
      <SkeletonRows rows={5} />
    </div>
  )
}
