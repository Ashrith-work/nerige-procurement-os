import { requireProcurement } from '@/lib/auth/session'
import { SelectionProvider } from '@/lib/reorder/selection'

/**
 * Mounted once for /reorder and /reorder/review, so the selection survives
 * changing vendor, changing collection, paging, and walking to the review step
 * and back.
 */
export default async function ReorderLayout({ children }: { children: React.ReactNode }) {
  await requireProcurement()
  return <SelectionProvider>{children}</SelectionProvider>
}
