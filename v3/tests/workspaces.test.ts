/**
 * Workspaces: yours alone, and never a way to reach more than your role allows.
 *
 * Two properties are worth a test rather than a reading. First, isolation: a
 * workspace list is a record of how a person arranges their day and nobody else
 * — including the owner — has business reading it, which is unusual enough in
 * this schema to be asserted rather than assumed. Second, narrowing: the
 * resolver must intersect a saved workspace with what the role may reach, so a
 * row edited by hand (or a role narrowed after the fact) cannot put a section in
 * front of somebody the guards would refuse.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { Client } from 'pg'
import { getTestDb, type TestDb } from './harness/db'
import { seedWorld, type World } from './harness/fixtures'
import {
  activeWorkspace,
  availableSections,
  homeFor,
  resolveWorkspaces,
  sectionsFor,
  SECTIONS,
  TEMPLATES,
  type WorkspaceRow,
} from '../src/lib/workspaces'

let db: TestDb
let w: World
let owner: string
let support: string

const makeStaff = async (c: Client, role: string, email: string): Promise<string> => {
  const { rows } = await c.query<{ id: string }>('insert into auth.users (email) values ($1) returning id', [email])
  await c.query(
    `insert into app_users (id, role, status, full_name, email) values ($1, $2::app_role, 'active', $3, $4)`,
    [rows[0].id, role, email, email],
  )
  return rows[0].id
}

beforeAll(async () => {
  db = await getTestDb()
  w = await db.asAdmin((c) => seedWorld(c))
  ;[owner, support] = await db.asAdmin(async (c) => [
    await makeStaff(c, 'admin', 'owner-ws@nerige.test'),
    await makeStaff(c, 'customer_support', 'support-ws@nerige.test'),
  ])
}, 180_000)

afterAll(async () => {
  await db?.stop()
})

const count = async (c: Client, sql: string, params: unknown[] = []): Promise<number> => {
  const { rows } = await c.query<{ n: string }>(sql, params)
  return Number(rows[0].n)
}

describe('workspace preferences are private', () => {
  it('a person reads and writes their own, and nobody else’s', async () => {
    // Seeded through asAdmin because every asUser block is a rolled-back
    // transaction: a row written in one is gone before the next one reads.
    await db.asAdmin(async (c) => {
      await c.query(`insert into user_workspaces (user_id, key, is_default) values ($1, 'ordering', true)`, [owner])
      await c.query(`insert into user_workspaces (user_id, key) values ($1, 'numbers')`, [support])
    })

    // The write path itself, under the caller's own policy.
    await db.asUser(owner, async (c) => {
      const inserted = await c.query(
        `insert into user_workspaces (user_id, key) values ($1, 'running-it') returning key`,
        [owner],
      )
      expect(inserted.rowCount).toBe(1)
    })

    await db.asUser(owner, async (c) => {
      expect(await count(c, 'select count(*) as n from user_workspaces')).toBe(1)
    })

    // The owner is an admin and still cannot see support's row: this table has
    // no internal read policy at all, which is the point.
    await db.asUser(support, async (c) => {
      expect(await count(c, 'select count(*) as n from user_workspaces where user_id = $1', [owner])).toBe(0)
    })
  })

  it('cannot be written on somebody else’s behalf', async () => {
    await expect(
      db.asUser(support, (c) =>
        c.query(`insert into user_workspaces (user_id, key) values ($1, 'ordering')`, [owner]),
      ),
    ).rejects.toThrow(/row-level security/)
  })

  it('permits one default per person', async () => {
    await expect(
      db.asAdmin((c) =>
        c.query(
          `insert into user_workspaces (user_id, key, is_default) values ($1, 'numbers', true), ($1, 'warehouse', true)`,
          [w.pooja],
        ),
      ),
    ).rejects.toThrow(/user_workspaces_one_default/)
  })

  it('a weaver sees none of this', async () => {
    await db.asUser(w.vendorA.ownerUser, async (c) => {
      expect(await count(c, 'select count(*) as n from user_workspaces')).toBe(0)
    })
  })
})

describe('resolving what a workspace shows', () => {
  it('drops sections the role may not reach', () => {
    // 'attributes' (master data) is admin-only; a warehouse manager who somehow
    // has it saved must not be offered it.
    const rows: WorkspaceRow[] = [
      { key: 'custom:1', name: 'Mine', sections: ['staff', 'attributes', 'inward'], hidden: false, is_default: true, sort: 0 },
    ]
    const [workspace] = resolveWorkspaces('warehouse_manager', rows)
    expect(workspace.sections.map((s) => s.key)).toEqual(['staff', 'inward'])
  })

  it('never offers a template to a role it is not for', () => {
    const forSupport = resolveWorkspaces('customer_support', []).map((ws) => ws.key)
    expect(forSupport).not.toContain('ordering')
    expect(forSupport).toContain('support')
  })

  it('hides what somebody hid, and keeps what they renamed', () => {
    const rows: WorkspaceRow[] = [
      { key: 'numbers', name: null, sections: null, hidden: true, is_default: false, sort: 0 },
      { key: 'ordering', name: 'Weaver orders', sections: null, hidden: false, is_default: true, sort: 1 },
    ]
    const resolved = resolveWorkspaces('admin', rows)
    expect(resolved.map((ws) => ws.key)).not.toContain('numbers')
    expect(resolved.find((ws) => ws.key === 'ordering')?.name).toBe('Weaver orders')
  })

  it('falls back to the default, then to the first', () => {
    const resolved = resolveWorkspaces('admin', [
      { key: 'warehouse', name: null, sections: null, hidden: false, is_default: true, sort: 9 },
    ])
    expect(activeWorkspace(resolved, 'nonsense')?.key).toBe('warehouse')
    expect(activeWorkspace(resolved, 'numbers')?.key).toBe('numbers')
    expect(activeWorkspace([], 'ordering')).toBeNull()
  })

  it('opens on its first section', () => {
    const [ordering] = resolveWorkspaces('admin', []).filter((ws) => ws.key === 'ordering')
    expect(homeFor(ordering)).toBe(ordering.sections[0].href)
  })

  it('every template names sections that exist and are reachable by its roles', () => {
    for (const template of TEMPLATES) {
      for (const key of template.sections) {
        const found = SECTIONS.find((s) => s.key === key)
        expect(found, `${template.key} names unknown section ${key}`).toBeTruthy()
      }
      for (const role of template.roles) {
        expect(
          sectionsFor(template.sections, role).length,
          `${template.key} is empty for ${role}`,
        ).toBeGreaterThan(0)
      }
    }
  })

  it('offers every role something to build a workspace from', () => {
    for (const role of ['admin', 'procurement_head', 'warehouse_manager', 'customer_support'] as const) {
      expect(availableSections(role).length).toBeGreaterThan(0)
    }
  })
})
