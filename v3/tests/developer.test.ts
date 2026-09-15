/**
 * The developer reads everything and writes nothing — proved against Postgres.
 *
 * The view-as switcher refuses writes in the application, but that refusal is
 * a courtesy. The guarantee is that the developer holds no write policy on any
 * table, and that every row-level-secured table carries the read policy — so a
 * table added by a later migration that forgets `app.grant_developer_read()`
 * fails HERE, rather than as a developer's view of a dashboard that is quietly
 * empty.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { Client } from 'pg'
import { getTestDb, type TestDb } from './harness/db'
import { seedWorld, type World } from './harness/fixtures'

let db: TestDb
let w: World
let developer: string

beforeAll(async () => {
  db = await getTestDb()
  w = await db.asAdmin((c) => seedWorld(c))
  developer = await db.asAdmin(async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `insert into auth.users (email) values ('dev@nerige.test') returning id`,
    )
    await c.query(
      `insert into app_users (id, role, status, full_name, email)
       values ($1, 'developer', 'active', 'Dev', 'dev@nerige.test')`,
      [rows[0].id],
    )
    return rows[0].id
  })
}, 180_000)

afterAll(async () => {
  await db?.stop()
})

const count = async (c: Client, sql: string, params: unknown[] = []): Promise<number> => {
  const { rows } = await c.query<{ n: string }>(sql, params)
  return Number(rows[0].n)
}

/**
 * A write is refused either by a missing grant (an error) or by RLS filtering
 * every row out of reach (zero rows affected). Both are refusals; the savepoint
 * keeps an error from poisoning the rest of the test's transaction.
 */
const refused = async (c: Client, sql: string, params: unknown[] = []): Promise<boolean> => {
  await c.query('savepoint w')
  try {
    const r = await c.query(sql, params)
    await c.query('release savepoint w')
    return r.rowCount === 0
  } catch {
    await c.query('rollback to savepoint w')
    return true
  }
}

describe('developer access', () => {
  it('every row-level-secured table carries the developer read policy', async () => {
    const missing = await db.asAdmin(async (c) => {
      const { rows } = await c.query<{ table_name: string }>(
        `select c.relname as table_name
           from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
            and not exists (
              select 1 from pg_policies p
               where p.schemaname = 'public' and p.tablename = c.relname
                 and p.policyname = c.relname || '_developer_read'
            )`,
      )
      return rows.map((r) => r.table_name)
    })
    expect(missing).toEqual([])
  })

  it('no write policy anywhere names the developer, except closing its own view log', async () => {
    const writes = await db.asAdmin(async (c) => {
      const { rows } = await c.query<{ policy: string }>(
        `select tablename || '.' || policyname as policy
           from pg_policies
          where schemaname = 'public'
            and cmd <> 'SELECT'
            and (coalesce(qual, '') || coalesce(with_check, '')) like '%is_developer%'`,
      )
      return rows.map((r) => r.policy).sort()
    })
    expect(writes).toEqual(['view_as_log.view_as_log_close_developer', 'view_as_log.view_as_log_insert_developer'])
  })

  it('reads both weavers, orders and intake', async () => {
    await db.asUser(developer, async (c) => {
      expect(await count(c, `select count(*) as n from vendors where code in ('AAA', 'BBB')`)).toBe(2)
      expect(await count(c, 'select count(*) as n from products')).toBe(6)
      expect(await count(c, 'select count(*) as n from orders')).toBe(2)
      expect(await count(c, 'select count(*) as n from product_intakes')).toBe(2)
      expect(await count(c, 'select count(*) as n from app_users')).toBeGreaterThanOrEqual(5)
    })
  })

  it('cannot update a product, an order, or master data', async () => {
    await db.asUser(developer, async (c) => {
      expect(await refused(c, `update products set manual_image_url = 'x' where sku = $1`, [w.vendorA.skus[0]])).toBe(true)
      expect(await refused(c, `update orders set status = 'cancelled' where id = $1`, [w.vendorA.orderId])).toBe(true)
      expect(await refused(c, `update master_data set value = 'x' where code = 'VINT'`)).toBe(true)
      expect(await refused(c, `update app_users set role = 'admin' where id = $1`, [developer])).toBe(true)
    })
  })

  it('cannot insert an intake', async () => {
    await expect(
      db.asUser(developer, (c) =>
        c.query(
          `insert into product_intakes (intake_key, vendor_id, collection_code, fabric_code,
             colour_code, product_type_code, cost_price)
           values ('DEV-1', $1, 'VINT', 'SLK', 'RED', 'SAREES', 100)`,
          [w.vendorA.id],
        ),
      ),
    ).rejects.toThrow(/row-level security/)
  })

  it('logs a view as itself, and cannot log one as somebody else', async () => {
    await db.asUser(developer, (c) =>
      c.query(
        `insert into view_as_log (developer_user_id, target_user_id, target_role) values ($1, $2, 'procurement_head')`,
        [developer, w.pooja],
      ),
    )
    await expect(
      db.asUser(w.pooja, (c) =>
        c.query(
          `insert into view_as_log (developer_user_id, target_user_id, target_role) values ($1, $1, 'procurement_head')`,
          [w.pooja],
        ),
      ),
    ).rejects.toThrow(/row-level security/)
  })

  it('a weaver gains nothing from the developer policies', async () => {
    await db.asUser(w.vendorA.ownerUser, async (c) => {
      expect(await count(c, 'select count(*) as n from products where vendor_id = $1', [w.vendorB.id])).toBe(0)
    })
  })
})
