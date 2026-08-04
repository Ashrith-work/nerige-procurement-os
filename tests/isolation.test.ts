/**
 * VENDOR ISOLATION SUITE — CI-blocking.
 *
 * One vendor seeing another vendor's pricing is a commercial incident, not a
 * bug report. This suite is the gate that stops it.
 *
 * The central test is deliberately written against the system catalog rather
 * than a hand-maintained list of tables: it discovers every table carrying a
 * `vendor_id` column and asserts that a vendor session can see none of the
 * other vendor's rows. When M3 adds purchase_orders and M6 adds invoices, they
 * are covered the moment they exist — nobody has to remember to extend this
 * file, which is precisely the kind of remembering that fails.
 *
 * Everything asserted here runs as the `authenticated` role. A superuser
 * bypasses RLS unconditionally, so a suite that forgot to switch roles would
 * pass while production leaked.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestDb, type TestDb } from './harness/db'
import { seedWorld, type World } from './harness/fixtures'

let db: TestDb
let w: World

beforeAll(async () => {
  db = await getTestDb()
  // Committed, so each assertion below can run in its own rolled-back transaction.
  w = await db.asAdmin((c) => seedWorld(c))
})

afterAll(async () => {
  await db?.stop()
})

/** Every public table carrying a vendor_id column, discovered at runtime. */
async function vendorScopedTables(): Promise<string[]> {
  const { rows } = await db.asAdmin((c) =>
    c.query<{ table_name: string }>(
      `select table_name from information_schema.columns
        where table_schema = 'public' and column_name = 'vendor_id'
        order by table_name`,
    ),
  )
  return rows.map((r) => r.table_name)
}

describe('cross-vendor isolation', () => {
  it('discovers the vendor-scoped tables it is protecting', async () => {
    const tables = await vendorScopedTables()
    // Guards against the suite silently protecting nothing if a refactor
    // renames the anchor column.
    expect(tables).toContain('vendor_users')
    expect(tables).toContain('vendor_bank_accounts')
    expect(tables).toContain('documents')
    expect(tables.length).toBeGreaterThanOrEqual(5)
  })

  it('shows a vendor ZERO rows belonging to another vendor, on every scoped table', async () => {
    const tables = await vendorScopedTables()
    const leaks: string[] = []

    for (const table of tables) {
      // `events` is closed to all authenticated clients; it has no SELECT grant,
      // which surfaces as a permission error rather than an empty result. That
      // is a stronger guarantee, verified separately below.
      if (table === 'events') continue

      const count = await db.asUser(w.vendorB.ownerUser, async (c) => {
        const { rows } = await c.query<{ n: string }>(
          `select count(*)::text as n from ${table} where vendor_id = $1`,
          [w.vendorA.id],
        )
        return Number(rows[0].n)
      })

      if (count > 0) leaks.push(`${table} leaked ${count} row(s)`)
    }

    expect(leaks).toEqual([])
  })

  it('shows a vendor exactly one vendor row — their own', async () => {
    const rows = await db.asUser(w.vendorB.ownerUser, async (c) => {
      const { rows } = await c.query<{ id: string; code: string }>('select id, code from vendors')
      return rows
    })

    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(w.vendorB.id)
    expect(rows[0].code).toBe('ILKAL')
  })

  it('isolates by ORGANISATION, so a second login sees the same data', async () => {
    // If a policy had keyed on user_id instead of vendor_id, the owner would
    // see the bank account and the manager would see nothing.
    const seenByOwner = await db.asUser(w.vendorA.ownerUser, async (c) => {
      const { rows } = await c.query('select id from vendor_bank_accounts')
      return rows.length
    })
    const seenByStaff = await db.asUser(w.vendorA.staffUser, async (c) => {
      const { rows } = await c.query('select id from vendor_bank_accounts')
      return rows.length
    })

    expect(seenByOwner).toBe(1)
    expect(seenByStaff).toBe(1)
  })

  it('does not leak another vendor even via a direct primary-key lookup', async () => {
    // Enumeration attempt: the attacker already knows the target's UUID.
    const rows = await db.asUser(w.vendorB.ownerUser, async (c) => {
      const { rows } = await c.query('select id from vendors where id = $1', [w.vendorA.id])
      return rows
    })
    expect(rows).toEqual([])
  })

  it('does not leak another vendor through a joined query', async () => {
    // Joins are where hand-written policies typically fail: the base table is
    // filtered but the joined one is not.
    const rows = await db.asUser(w.vendorB.ownerUser, async (c) => {
      const { rows } = await c.query(
        `select b.id
           from vendor_bank_accounts b
           join vendors v on v.id = b.vendor_id
          where v.code = 'SHAN'`,
      )
      return rows
    })
    expect(rows).toEqual([])
  })

  it('hides another vendor even in aggregate counts', async () => {
    // An unfiltered COUNT is an information leak in itself: it reveals how many
    // vendors we work with.
    const total = await db.asUser(w.vendorB.ownerUser, async (c) => {
      const { rows } = await c.query<{ n: string }>('select count(*)::text as n from vendors')
      return Number(rows[0].n)
    })
    expect(total).toBe(1)
  })
})

describe('storage object isolation', () => {
  it("denies a vendor another vendor's document object", async () => {
    const rows = await db.asUser(w.vendorB.ownerUser, async (c) => {
      const { rows } = await c.query(
        `select name from storage.objects
          where bucket_id = 'vendor-documents' and name like 'vendors/' || $1::text || '%'`,
        [w.vendorA.id],
      )
      return rows
    })
    expect(rows).toEqual([])
  })

  it('allows a vendor their own document object', async () => {
    const rows = await db.asUser(w.vendorB.ownerUser, async (c) => {
      const { rows } = await c.query(`select name from storage.objects`)
      return rows
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toContain(w.vendorB.id)
  })

  it('fails closed on a malformed storage path', async () => {
    // A path that does not match vendors/{uuid}/... must match no policy at
    // all, rather than accidentally matching everything.
    await db.asAdmin(async (c) => {
      const { rows } = await c.query<{ v: string | null }>(
        `select app.storage_path_vendor_id($1) as v`,
        ['public/../../etc/passwd'],
      )
      expect(rows[0].v).toBeNull()
    })
    await db.asAdmin(async (c) => {
      const { rows } = await c.query<{ v: string | null }>(
        `select app.storage_path_vendor_id($1) as v`,
        ['vendors/not-a-uuid/file.pdf'],
      )
      expect(rows[0].v).toBeNull()
    })
  })
})

describe('vendor write restrictions (M1 is read-only for vendors)', () => {
  it('forbids a vendor editing their own vendor record', async () => {
    const updated = await db.asUser(w.vendorB.ownerUser, async (c) => {
      const res = await c.query(`update vendors set display_name = 'Renamed' where id = $1`, [
        w.vendorB.id,
      ])
      return res.rowCount
    })
    expect(updated).toBe(0)
  })

  it("forbids a vendor editing another vendor's bank account", async () => {
    const updated = await db.asUser(w.vendorB.ownerUser, async (c) => {
      const res = await c.query(
        `update vendor_bank_accounts set ifsc = 'HDFC0009999' where id = $1`,
        [w.vendorA.bankId],
      )
      return res.rowCount
    })
    expect(updated).toBe(0)
  })

  it('forbids a vendor creating a vendor', async () => {
    await db.asUser(w.vendorB.ownerUser, async (c) => {
      await c.query('savepoint p')
      await expect(
        c.query(
          `insert into vendors (code, legal_name, display_name, gst_registration_type)
           values ('EVIL', 'Evil Co', 'Evil Co', 'unregistered')`,
        ),
      ).rejects.toThrow(/row-level security/i)
      await c.query('rollback to savepoint p')
    })
  })

  it('forbids a vendor granting themselves access to another vendor', async () => {
    // The most direct privilege-escalation attempt available to a vendor.
    await db.asUser(w.vendorB.ownerUser, async (c) => {
      await c.query('savepoint p')
      await expect(
        c.query(`insert into vendor_users (vendor_id, user_id) values ($1, $2)`, [
          w.vendorA.id,
          w.vendorB.ownerUser,
        ]),
      ).rejects.toThrow(/row-level security/i)
      await c.query('rollback to savepoint p')
    })
  })

  it('forbids a user promoting themselves to founder', async () => {
    // Raises rather than silently affecting zero rows. The distinction is
    // meaningful: a USING failure hides the row, whereas a WITH CHECK failure
    // means the row was visible and the *proposed value* was refused. Privilege
    // escalation should be loud.
    await db.asUser(w.vendorB.ownerUser, async (c) => {
      await c.query('savepoint p')
      await expect(
        c.query(`update app_users set role = 'founder' where id = $1`, [w.vendorB.ownerUser]),
      ).rejects.toThrow(/row-level security/i)
      await c.query('rollback to savepoint p')
    })
  })

  it('forbids a suspended user reactivating themselves', async () => {
    await db.asAdmin(async (c) => {
      await c.query('begin')
      try {
        await c.query(`update app_users set status = 'suspended' where id = $1`, [
          w.vendorB.ownerUser,
        ])
        await c.query('set local role authenticated')
        await c.query("select set_config('request.jwt.claim.sub', $1, true)", [w.vendorB.ownerUser])
        await c.query('savepoint p')
        await expect(
          c.query(`update app_users set status = 'active' where id = $1`, [w.vendorB.ownerUser]),
        ).rejects.toThrow(/row-level security/i)
        await c.query('rollback to savepoint p')
      } finally {
        await c.query('rollback')
      }
    })
  })

  it('allows a user to change their own display name and language', async () => {
    // The permitted half of self-service: proves the guard is targeted at role
    // and status rather than blocking profile edits wholesale.
    const updated = await db.asUser(w.vendorB.ownerUser, async (c) => {
      const res = await c.query(
        `update app_users set full_name = 'Renamed Owner', locale = 'kn' where id = $1`,
        [w.vendorB.ownerUser],
      )
      return res.rowCount
    })
    expect(updated).toBe(1)
  })
})

describe('audit trail and outbox confidentiality', () => {
  it('denies vendors the audit log entirely', async () => {
    const rows = await db.asUser(w.vendorB.ownerUser, async (c) => {
      const { rows } = await c.query('select id from audit_log')
      return rows
    })
    expect(rows).toEqual([])
  })

  it('denies vendors the outbox at the privilege level, not the row level', async () => {
    await db.asUser(w.vendorB.ownerUser, async (c) => {
      await c.query('savepoint p')
      await expect(c.query('select id from events')).rejects.toThrow(/permission denied/i)
      await c.query('rollback to savepoint p')
    })
  })

  it('denies the Warehouse Manager the audit log', async () => {
    // Least privilege among internal staff too: the trail spans every vendor's
    // commercial terms, so its audience stays as small as the job allows.
    const rows = await db.asUser(w.warehouseManager, async (c) => {
      const { rows } = await c.query('select id from audit_log')
      return rows
    })
    expect(rows).toEqual([])
  })

  it('records who changed a vendor, with the changed keys', async () => {
    await db.asAdmin(async (c) => {
      await c.query('begin')
      try {
        await c.query("select set_config('request.jwt.claim.sub', $1, true)", [w.procurementHead])
        await c.query(`update vendors set notes = 'Called about delayed dispatch' where id = $1`, [
          w.vendorA.id,
        ])
        const { rows } = await c.query<{
          actor_id: string
          actor_role: string
          changed_keys: string[]
        }>(
          `select actor_id, actor_role, changed_keys from audit_log
            where table_name = 'vendors' and record_id = $1
            order by occurred_at desc limit 1`,
          [w.vendorA.id],
        )
        expect(rows[0].actor_id).toBe(w.procurementHead)
        expect(rows[0].actor_role).toBe('procurement_head')
        // updated_at and version are excluded as noise.
        expect(rows[0].changed_keys).toEqual(['notes'])
      } finally {
        await c.query('rollback')
      }
    })
  })

  it('redacts bank account numbers from the audit trail', async () => {
    const { rows } = await db.asAdmin((c) =>
      c.query<{ new_data: Record<string, unknown> }>(
        `select new_data from audit_log
          where table_name = 'vendor_bank_accounts' order by occurred_at desc limit 1`,
      ),
    )
    expect(rows[0].new_data.account_number).toBe('[redacted]')
    // The IFSC is retained: it identifies the bank without enabling a payout.
    expect(rows[0].new_data.ifsc).toBe('HDFC0001234')
  })
})

describe('access revocation', () => {
  it('cuts off a suspended user within the same request', async () => {
    // Role and status live in the database, not the JWT, precisely so
    // revocation does not wait for a token refresh.
    await db.asAdmin(async (c) => {
      await c.query('begin')
      try {
        await c.query(`update app_users set status = 'suspended' where id = $1`, [
          w.vendorB.ownerUser,
        ])
        await c.query('set local role authenticated')
        await c.query("select set_config('request.jwt.claim.sub', $1, true)", [w.vendorB.ownerUser])

        const { rows } = await c.query('select id from vendors')
        expect(rows).toEqual([])
      } finally {
        await c.query('rollback')
      }
    })
  })

  it('gives an anonymous caller nothing', async () => {
    await db.asAnon(async (c) => {
      await c.query('savepoint p')
      await expect(c.query('select id from vendors')).rejects.toThrow(/permission denied/i)
      await c.query('rollback to savepoint p')
    })
  })
})

describe('internal staff visibility', () => {
  it('lets the Founder and Procurement Head see all vendors', async () => {
    for (const user of [w.founder, w.procurementHead]) {
      const n = await db.asUser(user, async (c) => {
        const { rows } = await c.query<{ n: string }>('select count(*)::text as n from vendors')
        return Number(rows[0].n)
      })
      expect(n).toBe(2)
    }
  })

  it('lets the Warehouse Manager read vendors but not create them', async () => {
    const visible = await db.asUser(w.warehouseManager, async (c) => {
      const { rows } = await c.query<{ n: string }>('select count(*)::text as n from vendors')
      return Number(rows[0].n)
    })
    expect(visible).toBe(2)

    await db.asUser(w.warehouseManager, async (c) => {
      await c.query('savepoint p')
      await expect(
        c.query(
          `insert into vendors (code, legal_name, display_name, gst_registration_type)
           values ('WHNEW', 'Warehouse Made', 'Warehouse Made', 'unregistered')`,
        ),
      ).rejects.toThrow(/row-level security/i)
      await c.query('rollback to savepoint p')
    })
  })
})
