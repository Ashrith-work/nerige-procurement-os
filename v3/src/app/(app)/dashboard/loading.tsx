import { LoadingAnnouncement, SkeletonHeader, SkeletonTiles } from '@/components/ui/primitives'

/** Today asks six or seven counts across orders, intake, parcels and the staff sheet. */
export default function Loading() {
  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <LoadingAnnouncement label="Loading what is waiting on you" />
      <SkeletonHeader />
      <SkeletonTiles tiles={8} />
    </div>
  )
}
