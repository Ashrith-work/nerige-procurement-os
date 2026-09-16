import { LoadingAnnouncement, Skeleton, SkeletonHeader } from '@/components/ui/primitives'

export default function Loading() {
  return (
    <div className="space-y-5">
      <LoadingAnnouncement label="Loading the sarees to frame" />
      <SkeletonHeader />
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-11 w-48" />
        <Skeleton className="h-11 w-52" />
      </div>
      <Skeleton className="h-[420px] w-full" />
    </div>
  )
}
