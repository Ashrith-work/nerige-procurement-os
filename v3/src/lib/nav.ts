import type { AppRole } from '@/lib/auth/session'

/**
 * What each staff role's chrome offers, in one place.
 *
 * Every link here must be to a page whose own guard admits that role. A link a
 * role cannot follow is worse than no link: it is a tap that ends on "not
 * authorised". The previous layout offered /reorder and /orders to every
 * non-vendor, which was fine with two staff roles and wrong the moment a
 * warehouse manager could sign in.
 *
 * `top` is the header — the two or three screens that role lives in. `side` is
 * the panel — everything else it can reach. The vendor has her own chrome and
 * the developer's switcher has its own, so neither appears here.
 */
export interface NavLinkItem {
  href: string
  label: string
}

export interface RoleNav {
  top: NavLinkItem[]
  side: NavLinkItem[]
}

export function navFor(role: AppRole): RoleNav {
  switch (role) {
    case 'admin':
      return {
        top: [
          { href: '/dashboard', label: 'Dashboard' },
          { href: '/reorder', label: 'Reorder' },
          { href: '/orders', label: 'Orders' },
          { href: '/review', label: 'Review' },
        ],
        side: [
          { href: '/admin/performance', label: 'Staff performance' },
          { href: '/warehouse', label: 'Warehouse' },
          { href: '/warehouse/inward', label: 'Inwarding' },
          { href: '/intake/queue', label: 'Intake queue' },
          { href: '/admin/vendors', label: 'My vendors' },
          { href: '/admin/products', label: 'Products' },
          { href: '/admin/products/unidentified', label: 'To be identified' },
          { href: '/admin/master-data', label: 'Master data' },
          { href: '/admin/signups', label: 'Account requests' },
          { href: '/admin/insights', label: 'Insights' },
          { href: '/lookup', label: 'Lookup' },
          { href: '/admin/settings', label: 'Settings' },
          { href: '/admin/profile', label: 'My profile' },
        ],
      }
    case 'procurement_head':
      return {
        top: [
          { href: '/dashboard', label: 'Dashboard' },
          { href: '/reorder', label: 'Reorder' },
          { href: '/orders', label: 'Orders' },
          { href: '/review', label: 'Review' },
        ],
        side: [
          { href: '/warehouse/inward', label: 'Inwarding' },
          { href: '/intake/queue', label: 'Intake queue' },
          { href: '/admin/vendors', label: 'My vendors' },
          { href: '/admin/products', label: 'Products' },
          { href: '/admin/insights', label: 'Insights' },
          { href: '/lookup', label: 'Lookup' },
          { href: '/admin/settings', label: 'Settings' },
          { href: '/admin/profile', label: 'My profile' },
        ],
      }
    case 'warehouse_manager':
      return {
        top: [
          { href: '/warehouse', label: 'Home' },
          { href: '/warehouse/staff', label: 'Staff sheet' },
          { href: '/intake/new', label: 'New saree' },
        ],
        side: [
          { href: '/intake/queue', label: 'Intake queue' },
          { href: '/warehouse/shooting', label: 'Shooting' },
          { href: '/warehouse/inward', label: 'Inwarding' },
          { href: '/lookup', label: 'Lookup' },
        ],
      }
    case 'customer_support':
      return { top: [{ href: '/lookup', label: 'Lookup' }], side: [] }
    case 'vendor':
    case 'developer':
      return { top: [], side: [] }
  }
}
