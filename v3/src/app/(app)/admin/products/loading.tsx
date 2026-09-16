import { LoadingAnnouncement, Skeleton, SkeletonHeader, SkeletonTiles } from '@/components/ui/primitives'

/**
 * The catalogue is 10,160 designs behind a count(*) and a photograph per tile.
 * On the warehouse's connection that is seconds, and seconds of white screen is
 * indistinguishable from a broken link — people press back, then press the link
 * again, and the query runs twice.
 */
export default function Loading() {
  return (
    <div className="space-y-5">
      <LoadingAnnouncement label="Loading the designs" />
      <SkeletonHeader />
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-11 w-44" />
        <Skeleton className="h-11 w-52" />
        <Skeleton className="h-11 w-40" />
      </div>
      <SkeletonTiles />
    </div>
  )
}
