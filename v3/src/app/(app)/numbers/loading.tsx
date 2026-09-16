import { LoadingAnnouncement, SkeletonHeader, SkeletonTiles } from '@/components/ui/primitives'

/** Three insight RPCs over a whole period, plus movers and the staff sheet. */
export default function Loading() {
  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <LoadingAnnouncement label="Loading the numbers" />
      <SkeletonHeader />
      <SkeletonTiles tiles={8} />
    </div>
  )
}
