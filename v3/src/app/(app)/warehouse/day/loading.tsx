import { LoadingAnnouncement, Skeleton, SkeletonHeader } from '@/components/ui/primitives'

/**
 * The day sheet's shape while it loads.
 *
 * Drawn in the page's own proportions — three movements, each a row of boxes
 * over a grid — so the screen does not jump when the day arrives. A day with
 * forty sarees on it and a catalogue check per code is a second or two, and a
 * blank page for a second or two is indistinguishable from a broken one.
 */
export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl space-y-10">
      <LoadingAnnouncement label="Loading the day sheet" />
      <SkeletonHeader />

      <div className="space-y-8">
        {Array.from({ length: 3 }, (_, section) => (
          <div key={section} className="space-y-3">
            <Skeleton className="h-5 w-24" />
            <div className="grid gap-2 sm:grid-cols-3">
              {Array.from({ length: 3 }, (_, box) => (
                <Skeleton key={box} className="h-20" />
              ))}
            </div>
            <Skeleton className="h-40 w-full" />
          </div>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, card) => (
          <Skeleton key={card} className="h-36" />
        ))}
      </div>
    </div>
  )
}
