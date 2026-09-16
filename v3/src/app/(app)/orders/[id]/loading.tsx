import { LoadingAnnouncement, Skeleton } from '@/components/ui/primitives'

export default function Loading() {
  return (
    <div className="mx-auto max-w-2xl space-y-8 pb-10">
      <LoadingAnnouncement label="Loading this order" />
      <div className="space-y-2">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-4 w-40" />
      </div>
      <Skeleton className="h-36 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  )
}
