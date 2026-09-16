import { LoadingAnnouncement, Skeleton, SkeletonHeader, SkeletonTiles } from '@/components/ui/primitives'

/**
 * The heaviest screen in the application: 9,218 designs in the pool, narrowed by
 * weaver and collection, each tile a photograph. Seconds of white screen here is
 * what teaches somebody to press back and start again.
 */
export default function Loading() {
  return (
    <div className="space-y-5">
      <LoadingAnnouncement label="Loading the designs" />
      <SkeletonHeader />
      <div className="grid gap-2 sm:grid-cols-4">
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
      </div>
      <SkeletonTiles />
    </div>
  )
}
