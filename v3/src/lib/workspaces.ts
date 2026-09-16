import type { AppRole } from '@/lib/auth/session'

/**
 * Workspaces: the job someone is doing, and the only thing that shapes their
 * navigation.
 *
 * WHY THIS EXISTS. `navFor(role)` gave the owner fourteen side links on every
 * screen — reorder, intake, staff, insights, settings — because the owner does
 * all of those jobs. But never at the same moment. A person ordering sarees is
 * not also naming attribute codes, and putting both in front of them makes each
 * slower to find and the screen harder to read.
 *
 * A workspace is a named job with a home screen and an ordered list of sections.
 * It narrows; it never widens. `sectionsFor()` intersects a workspace with what
 * the role may reach, so a workspace cannot hand anybody a screen their role
 * would refuse, and every screen a role may open stays reachable by URL whatever
 * workspace is open.
 *
 * The templates below are the shipped set. `user_workspaces` (migration 038)
 * holds only what a person changed: their default, their own workspaces, ones
 * they hid, and the order. Somebody who never opens the switcher gets this list.
 */

/**
 * The building blocks. One section is one destination with one job.
 *
 * `label` is what the person reads, and it is written as the job rather than as
 * the table: "Saree words", not "master data". These names are the whole of the
 * vocabulary people learn this application by, so they are kept short, plain and
 * identical everywhere they appear.
 */
export interface Section {
  key: string
  label: string
  href: string
  /** One line, shown when a workspace is being built. */
  blurb: string
  roles: readonly AppRole[]
}

const STAFF: readonly AppRole[] = ['admin', 'procurement_head', 'warehouse_manager', 'customer_support']
const INTERNAL: readonly AppRole[] = ['admin', 'procurement_head']
const WAREHOUSE: readonly AppRole[] = ['admin', 'warehouse_manager']
const RECEIVING: readonly AppRole[] = ['admin', 'procurement_head', 'warehouse_manager']

export const SECTIONS: readonly Section[] = [
  // The three dashboards, which are sections like any other.
  { key: 'today', label: 'Today', href: '/dashboard', blurb: 'What is waiting on you now', roles: STAFF },
  { key: 'work', label: 'In progress', href: '/work', blurb: 'Orders, sarees and parcels in flight', roles: RECEIVING },
  { key: 'numbers', label: 'Numbers', href: '/numbers', blurb: 'Every analysis, in one place', roles: INTERNAL },

  // Ordering.
  { key: 'order-flow', label: 'Order sarees', href: '/flows/order', blurb: 'Choose a weaver, choose designs, send', roles: INTERNAL },
  { key: 'reorder', label: 'Reorder grid', href: '/reorder', blurb: 'Every design that could be made again', roles: INTERNAL },
  { key: 'orders', label: 'Orders', href: '/orders', blurb: 'What you have sent, and where it got to', roles: INTERNAL },
  { key: 'weavers', label: 'Weavers', href: '/admin/vendors', blurb: 'The houses, their logins and languages', roles: INTERNAL },

  // New sarees.
  { key: 'new-saree', label: 'Add a saree', href: '/flows/new-saree', blurb: 'Submit, shoot and send for approval', roles: WAREHOUSE },
  { key: 'intake', label: 'Sarees being added', href: '/intake/queue', blurb: 'Everything part-way through', roles: STAFF },
  { key: 'shooting', label: 'Shooting', href: '/warehouse/shooting', blurb: 'What is waiting for the camera', roles: WAREHOUSE },
  { key: 'review', label: 'Approve sarees', href: '/review', blurb: 'Sign off or send back', roles: INTERNAL },
  { key: 'attributes', label: 'Saree words', href: '/admin/master-data', blurb: 'What each code in a SKU means', roles: ['admin'] },
  { key: 'identify', label: 'Whose saree is this', href: '/admin/products/unidentified', blurb: 'Designs with no weaver against them', roles: ['admin'] },
  { key: 'cropping', label: 'Cropping', href: '/admin/products/cropping', blurb: 'How each photograph is framed for her', roles: ['admin'] },

  // The warehouse.
  { key: 'receive-flow', label: 'Receive a parcel', href: '/flows/receive', blurb: 'Record what actually arrived', roles: RECEIVING },
  { key: 'inward', label: 'Parcels', href: '/warehouse/inward', blurb: 'On the way, part-received, done', roles: RECEIVING },
  { key: 'staff', label: 'Staff sheet', href: '/warehouse/staff', blurb: 'The floor staff’s day, person by person', roles: WAREHOUSE },
  { key: 'performance', label: 'Staff performance', href: '/admin/performance', blurb: 'The sheet, read back over a period', roles: ['admin'] },

  // Everything else.
  { key: 'lookup', label: 'Look something up', href: '/lookup', blurb: 'Stock and orders for any saree', roles: STAFF },
  { key: 'products', label: 'All designs', href: '/admin/products', blurb: 'The whole catalogue', roles: INTERNAL },
  { key: 'insights', label: 'Sales analysis', href: '/admin/insights', blurb: 'What sold, by collection, colour, weaver', roles: INTERNAL },
  { key: 'signups', label: 'Account requests', href: '/admin/signups', blurb: 'People asking for a login', roles: ['admin'] },
  { key: 'settings', label: 'Settings', href: '/admin/settings', blurb: 'Sync, integrations, tutorials', roles: INTERNAL },
  { key: 'profile', label: 'My profile', href: '/admin/profile', blurb: 'Your name and language', roles: INTERNAL },
]

const BY_KEY = new Map(SECTIONS.map((s) => [s.key, s]))

export function section(key: string): Section | null {
  return BY_KEY.get(key) ?? null
}

export interface WorkspaceTemplate {
  key: string
  /** The job, in the user's words. Two or three plain words. */
  name: string
  /** One line, for the switcher and the setup screen. */
  blurb: string
  sections: readonly string[]
  /** Which roles are offered this by default. */
  roles: readonly AppRole[]
}

/**
 * The shipped workspaces.
 *
 * Each is one job somebody actually sits down to do, and the order of its
 * sections is the order that job runs in: the flow first, then the places that
 * job looks things up. The first section is the home screen, so signing in lands
 * on the work rather than on a hub to navigate away from.
 */
export const TEMPLATES: readonly WorkspaceTemplate[] = [
  {
    key: 'ordering',
    name: 'Ordering sarees',
    blurb: 'Decide what to make again and send it to the weavers.',
    sections: ['today', 'order-flow', 'reorder', 'orders', 'work', 'weavers', 'lookup'],
    roles: ['admin', 'procurement_head'],
  },
  {
    key: 'new-sarees',
    name: 'New sarees',
    blurb: 'Bring a new design into the catalogue, from the floor to approval.',
    sections: ['today', 'new-saree', 'intake', 'shooting', 'review', 'attributes', 'cropping', 'identify'],
    roles: ['admin', 'procurement_head', 'warehouse_manager'],
  },
  {
    key: 'warehouse',
    name: 'The warehouse',
    blurb: 'The floor staff’s day and the parcels arriving from weavers.',
    sections: ['today', 'staff', 'receive-flow', 'inward', 'new-saree', 'intake', 'shooting', 'lookup'],
    roles: ['admin', 'warehouse_manager'],
  },
  {
    key: 'numbers',
    name: 'The numbers',
    blurb: 'Sales, sell-through and the floor staff, read over a period.',
    sections: ['numbers', 'insights', 'performance', 'products'],
    roles: ['admin', 'procurement_head'],
  },
  {
    key: 'support',
    name: 'Answering questions',
    blurb: 'Look up any saree: stock, sales and what is on its way.',
    sections: ['lookup', 'intake'],
    roles: ['admin', 'customer_support'],
  },
  {
    key: 'running-it',
    name: 'Running it',
    blurb: 'Accounts, settings, weavers and the sync.',
    sections: ['today', 'signups', 'weavers', 'settings', 'attributes', 'identify', 'profile'],
    roles: ['admin'],
  },
]

export interface Workspace {
  key: string
  name: string
  blurb: string
  sections: Section[]
  isDefault: boolean
  /** True for one somebody built themselves. */
  custom: boolean
}

/** A person's saved preferences, as stored in `user_workspaces`. */
export interface WorkspaceRow {
  key: string
  name: string | null
  sections: string[] | null
  hidden: boolean
  is_default: boolean
  sort: number
}

export function isCustomKey(key: string): boolean {
  return key.startsWith('custom:')
}

/** The sections of a workspace this role may actually reach, in workspace order. */
export function sectionsFor(keys: readonly string[], role: AppRole): Section[] {
  return keys
    .map((key) => BY_KEY.get(key))
    .filter((s): s is Section => Boolean(s) && s!.roles.includes(role))
}

/** Every section this role may reach, for building a workspace of one's own. */
export function availableSections(role: AppRole): Section[] {
  return SECTIONS.filter((s) => s.roles.includes(role))
}

/**
 * What this person's switcher shows: the templates their role is offered, minus
 * the ones they hid, plus the ones they built, in their order.
 *
 * A workspace whose sections are all out of the role's reach is dropped rather
 * than shown empty — that happens when a role is narrowed after somebody built a
 * workspace, and an empty workspace is a dead end that looks like a bug.
 */
export function resolveWorkspaces(role: AppRole, rows: readonly WorkspaceRow[]): Workspace[] {
  const byKey = new Map(rows.map((r) => [r.key, r]))

  const fromTemplates = TEMPLATES.filter((t) => t.roles.includes(role))
    .filter((t) => !byKey.get(t.key)?.hidden)
    .map((t) => {
      const row = byKey.get(t.key)
      return {
        key: t.key,
        name: row?.name ?? t.name,
        blurb: t.blurb,
        sections: sectionsFor(row?.sections ?? t.sections, role),
        isDefault: row?.is_default ?? false,
        custom: false,
        sort: row?.sort ?? TEMPLATES.indexOf(t),
      }
    })

  const fromRows = rows
    .filter((r) => isCustomKey(r.key) && !r.hidden)
    .map((r) => ({
      key: r.key,
      name: r.name ?? 'My workspace',
      blurb: 'Yours',
      sections: sectionsFor(r.sections ?? [], role),
      isDefault: r.is_default,
      custom: true,
      sort: r.sort,
    }))

  return [...fromTemplates, ...fromRows]
    .filter((w) => w.sections.length > 0)
    .sort((a, b) => a.sort - b.sort)
    .map(({ sort: _sort, ...w }) => w)
}

/**
 * The workspace in play: the one asked for, else the person's default, else the
 * first they have. Null only when a role has none at all — a weaver, who has one
 * job and needs no switcher.
 */
export function activeWorkspace(workspaces: Workspace[], requested: string | null | undefined): Workspace | null {
  if (workspaces.length === 0) return null
  if (requested) {
    const asked = workspaces.find((w) => w.key === requested)
    if (asked) return asked
  }
  return workspaces.find((w) => w.isDefault) ?? workspaces[0]
}

/** Where a workspace opens: its first section. */
export function homeFor(workspace: Workspace): string {
  return workspace.sections[0]?.href ?? '/dashboard'
}
