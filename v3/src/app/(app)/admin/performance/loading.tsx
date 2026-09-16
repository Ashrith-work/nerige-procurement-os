import { LoadingAnnouncement, Skeleton, SkeletonHeader } from '@/components/ui/primitives'

/**
 * This one reads a whole period of the staff sheet back — every person, every
 * day, every task — so it is the slowest screen the founders open.
 */
export default function Loading() {
  return (
    <div className="space-y-6">
      <LoadingAnnouncement label="Reading the staff sheet back over this period" />
      <SkeletonHeader />
      <Skeleton className="h-11 w-full max-w-md" />
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  )
}
