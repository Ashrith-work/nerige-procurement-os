import { LoadingAnnouncement, SkeletonHeader, SkeletonTiles } from '@/components/ui/primitives'

/** The pipeline is four counts plus the oldest order in each stage. */
export default function Loading() {
  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <LoadingAnnouncement label="Loading what is in progress" />
      <SkeletonHeader />
      <SkeletonTiles tiles={8} />
    </div>
  )
}
