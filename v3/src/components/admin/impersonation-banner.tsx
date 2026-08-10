import type { ImpersonatedVendor } from '@/lib/auth/impersonation'
import { stopImpersonating } from '@/app/(app)/admin/vendors/actions'

/**
 * The strip that says whose screen this is.
 *
 * Amber, full width, above everything including the navigation, and it does not
 * scroll away. The failure it prevents is not subtle and is not rare: Pooja
 * opens a weaver's portal to answer a question, gets distracted, and twenty
 * minutes later is reading "your order" and "you accepted this" believing it is
 * about her. Every sentence on these screens is written in the second person to
 * a weaver, which is exactly what makes the confusion easy.
 *
 * The way out is in the banner rather than in a menu, because the moment she
 * needs it is the moment she has realised she is in the wrong place.
 */
export function ImpersonationBanner({ vendor }: { vendor: ImpersonatedVendor }) {
  return (
    <div className="no-print sticky top-0 z-50 border-b border-amber-300 bg-amber-100">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm text-amber-900">
        <span className="font-medium">Viewing as {vendor.displayName}</span>
        <span className="font-mono text-xs">{vendor.code}</span>
        <span className="text-amber-700">Read only — nothing you do here is saved.</span>

        <form action={stopImpersonating} className="ml-auto">
          <button
            type="submit"
            className="min-h-9 rounded-lg border border-amber-400 bg-white px-3 text-sm font-medium text-amber-900 hover:bg-amber-50"
          >
            Stop viewing
          </button>
        </form>
      </div>
    </div>
  )
}
