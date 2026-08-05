/**
 * VENDOR ISOLATION SUITE — CI-blocking.
 *
 * One weaver seeing another weaver's designs, prices or orders is a commercial
 * incident, not a bug report. This suite is the gate that stops it.
 *
 * The central test is written against the system catalog rather than a
 * hand-maintained list of tables: it discovers every vendor-scoped relation and
 * how ownership of one of its rows is decided, then asserts a vendor session can
 * see none of the other vendor's. Two of those relations — `order_lines` and
 * `order_line_refs` — carry no `vendor_id` at all and are found by walking
 * foreign keys, which is the case a hand-written list gets wrong first.
 *
 * Everything asserted here runs as the `authenticated` role. A superuser
 * bypasses RLS unconditionally even with FORCE ROW LEVEL SECURITY set, so a
 * suite that forgot to switch roles would pass while production leaked.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { Client } from 'pg'
import { getTestDb, type TestDb } from './harness/db'
import { seedWorld, type World } from './harness/fixtures'
import { discoverScopedRelations, type ScopedRelation } from './harness/discovery'

let db: TestDb
let w: World
let scoped: ScopedRelation[]

beforeAll(async () => {
  db = await getTestDb()
  // Committed, so each assertion below can run in its own rolled-back transaction.
  w = await db.asAdmin((c) => seedWorld(c))
  scoped = await db.asAdmin((c) => discoverScopedRelations(c))
}, 180_000)

afterAll(async () => {
  await db?.stop()
})

const count = async (c: Client, sql: string, params: unknown[] = []): Promise<number> => {
  const { rows } = await c.query<{ n: string }>(sql, params)
  return Number(rows[0].n)
}

describe('discovery', () => {
  it('finds the relations that carry vendor_id', () => {
    const direct = scoped.filter((s) => s.depth === 0).map((s) => s.tableName)
    expect(direct).toContain('products')
    expect(direct).toContain('orders')
    expect(direct).toContain('vendor_users')
  })

  it('finds the relations that carry no vendor_id, through their parent', () => {
    // The case the spec calls out: these two are scoped through the parent
    // order, and a hand-written list is exactly where they go missing.
    const names = scoped.map((s) => s.tableName)
    expect(names).toContain('order_lines')
    expect(names).toContain('order_line_refs')

    // order_line_refs is reachable two ways — through its parent line into the
    // order, and through the design it points at. Both are followed, because a
    // vendor must see none of the other's rows by either route.
    const refPaths = scoped.filter((s) => s.tableName === 'order_line_refs')
    expect(refPaths.length).toBeGreaterThanOrEqual(2)
    expect(refPaths.some((p) => p.ownerPredicate.includes('order_lines'))).toBe(true)
    expect(refPaths.every((p) => p.ownerPredicate.includes('vendor_id = $1'))).toBe(true)

    // And the path that cannot establish ownership is not followed:
    // order_lines.sku is null on every new-design line.
    const linePaths = scoped.filter((s) => s.tableName === 'order_lines')
    expect(linePaths.every((p) => p.ownerPredicate.includes('orders'))).toBe(true)
  })

  it('covers views as well as tables', () => {
    // A view is the most likely place for a leak, because RLS does not apply to
    // it directly — it applies to what it selects from, and only if the view
    // was declared security_invoker.
    expect(scoped.some((s) => s.kind === 'v')).toBe(true)
  })

  it('is protecting a meaningful number of relations', () => {
    const names = new Set(scoped.map((s) => s.tableName))
    expect(names.size).toBeGreaterThanOrEqual(6)
  })
})

describe('cross-vendor isolation', () => {
  it("every discovered relation actually holds the other vendor's rows", async () => {
    // Without this, the assertion below would pass on an empty table and prove
    // nothing at all.
    const empty: string[] = []
    for (const rel of scoped) {
      const n = await db.asAdmin((c) =>
        count(c, `select count(*)::text as n from ${rel.tableName} where ${rel.ownerPredicate}`, [
          w.vendorA.id,
        ]),
      )
      if (n === 0) empty.push(`${rel.tableName} (depth ${rel.depth})`)
    }
    expect(empty).toEqual([])
  })

  it('shows a vendor ZERO rows belonging to another vendor, on every scoped relation', async () => {
    const leaks: string[] = []

    for (const rel of scoped) {
      const n = await db.asUser(w.vendorB.ownerUser, (c) =>
        count(c, `select count(*)::text as n from ${rel.tableName} where ${rel.ownerPredicate}`, [
          w.vendorA.id,
        ]),
      )
      if (n > 0) leaks.push(`${rel.tableName} leaked ${n} row(s) via ${rel.ownerPredicate}`)
    }

    expect(leaks).toEqual([])
  })

  it('shows a vendor only her own rows, on every scoped relation', async () => {
    // The other half: isolation that hides everything is not isolation, it is
    // an outage. Every relation must return the vendor's own rows in full.
    const wrong: string[] = []

    for (const rel of scoped) {
      const mine = await db.asAdmin((c) =>
        count(c, `select count(*)::text as n from ${rel.tableName} where ${rel.ownerPredicate}`, [
          w.vendorB.id,
        ]),
      )
      const visible = await db.asUser(w.vendorB.ownerUser, (c) =>
        count(c, `select count(*)::text as n from ${rel.tableName}`),
      )
      if (visible !== mine) wrong.push(`${rel.tableName}: sees ${visible}, owns ${mine}`)
    }

    expect(wrong).toEqual([])
  })

  it('shows a vendor exactly one vendor row — her own', async () => {
    const rows = await db.asUser(w.vendorB.ownerUser, async (c) => {
      const { rows } = await c.query<{ id: string; code: string }>('select id, code from vendors')
      return rows
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(w.vendorB.id)
    expect(rows[0].code).toBe('BBB')
  })

  it('isolates by ORGANISATION, so a second login sees the same orders', async () => {
    // If a policy had keyed on user_id, the owner would see the order and the
    // manager would see nothing.
    const byOwner = await db.asUser(w.vendorA.ownerUser, (c) =>
      count(c, 'select count(*)::text as n from orders'),
    )
    const byStaff = await db.asUser(w.vendorA.staffUser, (c) =>
      count(c, 'select count(*)::text as n from orders'),
    )
    expect(byOwner).toBe(1)
    expect(byStaff).toBe(1)
  })

  it('does not leak another vendor even via a direct primary-key lookup', async () => {
    // Enumeration attempt: the attacker already knows the target's id.
    for (const [table, id] of [
      ['orders', w.vendorA.orderId],
      ['order_lines', w.vendorA.restockLineId],
      ['products', w.vendorA.skus[0]],
    ] as const) {
      const key = table === 'products' ? 'sku' : 'id'
      const n = await db.asUser(w.vendorB.ownerUser, (c) =>
        count(c, `select count(*)::text as n from ${table} where ${key} = $1`, [id]),
      )
      expect(`${table}:${n}`).toBe(`${table}:0`)
    }
  })

  it('does not leak another vendor through a joined query', async () => {
    // Joins are where hand-written policies typically fail: the base table is
    // filtered and the joined one is not.
    const n = await db.asUser(w.vendorB.ownerUser, (c) =>
      count(
        c,
        `select count(*)::text as n
           from order_line_refs r
           join order_lines ol on ol.id = r.order_line_id
           join orders o on o.id = ol.order_id
           join vendors v on v.id = o.vendor_id
          where v.code = 'AAA'`,
      ),
    )
    expect(n).toBe(0)
  })

  it('hides another vendor even in aggregate counts', async () => {
    // An unfiltered COUNT is a leak in itself: it reveals how many weavers we
    // work with, and how much we buy.
    const vendors = await db.asUser(w.vendorB.ownerUser, (c) =>
      count(c, 'select count(*)::text as n from vendors'),
    )
    const designs = await db.asUser(w.vendorB.ownerUser, (c) =>
      count(c, 'select count(*)::text as n from products'),
    )
    expect(vendors).toBe(1)
    expect(designs).toBe(3)
  })

  it('scopes the collection view to the caller, not to its owner', async () => {
    // A view without security_invoker runs as its OWNER, and every weaver would
    // see every other weaver's collections through it. Asserted separately from
    // the generic sweep because this is the specific failure it prevents.
    const rows = await db.asUser(w.vendorB.ownerUser, async (c) => {
      const { rows } = await c.query<{ vendor_id: string; design_count: number }>(
        'select vendor_id, design_count from vendor_collections',
      )
      return rows
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].vendor_id).toBe(w.vendorB.id)
    expect(Number(rows[0].design_count)).toBe(3)
  })
})

describe('the structural guarantees isolation rests on', () => {
  it('has RLS enabled AND forced on every table', async () => {
    // Enabled alone is not enough: any connection that happens to run as the
    // table owner would silently bypass every policy.
    const rows = await db.asAdmin(async (c) => {
      const { rows } = await c.query<{ relname: string; enabled: boolean; forced: boolean }>(
        `select relname, relrowsecurity as enabled, relforcerowsecurity as forced
           from pg_class
          where relnamespace = 'public'::regnamespace and relkind = 'r'`,
      )
      return rows
    })
    expect(rows.length).toBeGreaterThanOrEqual(7)
    expect(rows.filter((r) => !r.enabled || !r.forced).map((r) => r.relname)).toEqual([])
  })

  it('pins search_path on every SECURITY DEFINER function', async () => {
    // The classic privilege-escalation hole: without a pinned path, a caller
    // who can create objects in a schema earlier on it can shadow `products`
    // or `app_users` and impersonate any vendor.
    const unpinned = await db.asAdmin(async (c) => {
      const { rows } = await c.query<{ nspname: string; proname: string }>(
        `select n.nspname, p.proname
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where p.prosecdef
            and n.nspname in ('public', 'app')
            and not exists (
              select 1 from unnest(coalesce(p.proconfig, '{}')) x where x like 'search_path=%'
            )`,
      )
      return rows.map((r) => `${r.nspname}.${r.proname}`)
    })
    expect(unpinned).toEqual([])
  })

  it('declares every view security_invoker', async () => {
    // A view is transparent to RLS only if it says so. One that does not is a
    // hole in the shape of the policies it appears to respect.
    const leaky = await db.asAdmin(async (c) => {
      const { rows } = await c.query<{ relname: string }>(
        `select c.relname
           from pg_class c
          where c.relnamespace = 'public'::regnamespace
            and c.relkind = 'v'
            and coalesce(
              (select option_value from pg_options_to_table(c.reloptions)
                where option_name = 'security_invoker'), 'false') <> 'true'`,
      )
      return rows.map((r) => r.relname)
    })
    expect(leaky).toEqual([])
  })

  it('gives anon nothing, anywhere', async () => {
    const grants = await db.asAdmin((c) =>
      count(
        c,
        `select count(*)::text as n from information_schema.role_table_grants
          where grantee = 'anon' and table_schema = 'public'`,
      ),
    )
    expect(grants).toBe(0)

    await db.asAnon(async (c) => {
      await c.query('savepoint p')
      await expect(c.query('select 1 from products limit 1')).rejects.toThrow(/permission denied/i)
      await c.query('rollback to savepoint p')
    })
  })

  it('keeps the isolation helpers out of PostgREST reach', async () => {
    // Anything in `public` is callable as an RPC. `app.current_vendor_id()` in
    // public would hand a vendor a way to probe the helper the policies trust.
    const exposed = await db.asAdmin(async (c) => {
      const { rows } = await c.query<{ proname: string }>(
        `select proname from pg_proc
          where pronamespace = 'public'::regnamespace
            and proname in ('current_vendor_id', 'current_role', 'is_internal', 'owns_vendor_row')`,
      )
      return rows.map((r) => r.proname)
    })
    expect(exposed).toEqual([])
  })
})

describe('the vendor write surface', () => {
  it('lets a vendor accept her own order and set a date', async () => {
    const n = await db.asUser(w.vendorB.ownerUser, async (c) => {
      const res = await c.query(
        `update orders set status = 'accepted', promised_date = current_date + 20 where id = $1`,
        [w.vendorB.orderId],
      )
      return res.rowCount
    })
    expect(n).toBe(1)
  })

  it("refuses a vendor another vendor's order entirely", async () => {
    const n = await db.asUser(w.vendorB.ownerUser, async (c) => {
      const res = await c.query(`update orders set status = 'accepted' where id = $1`, [
        w.vendorA.orderId,
      ])
      return res.rowCount
    })
    expect(n).toBe(0)
  })

  it('refuses a vendor any status move except accept then dispatch', async () => {
    await db.asUser(w.vendorB.ownerUser, async (c) => {
      await c.query('savepoint p')
      await expect(
        c.query(`update orders set status = 'received' where id = $1`, [w.vendorB.orderId]),
      ).rejects.toThrow(/accept an issued order or dispatch/i)
      await c.query('rollback to savepoint p')
    })
  })

  it('refuses a vendor the quantity, the brief and the code she was sent', async () => {
    // Two sides arguing from differently worded copies of the same order is the
    // thing this portal replaces, so the order she was sent is not hers to edit.
    await db.asUser(w.vendorB.ownerUser, async (c) => {
      await c.query('savepoint p')
      await expect(
        c.query(`update order_lines set quantity = 999 where id = $1`, [w.vendorB.restockLineId]),
      ).rejects.toThrow(/permission denied/i)
      await c.query('rollback to savepoint p')
    })
  })

  it('refuses a vendor issuing an order to herself', async () => {
    await db.asUser(w.vendorB.ownerUser, async (c) => {
      await c.query('savepoint p')
      await expect(
        c.query(`insert into orders (batch_id, vendor_id) values (gen_random_uuid(), $1)`, [
          w.vendorB.id,
        ]),
      ).rejects.toThrow(/row-level security/i)
      await c.query('rollback to savepoint p')
    })
  })

  it('refuses a vendor calling issue_orders as an RPC', async () => {
    // The function is SECURITY DEFINER and therefore bypasses RLS. Its guard is
    // the only thing between it and a vendor writing orders for anyone.
    await db.asUser(w.vendorB.ownerUser, async (c) => {
      await c.query('savepoint p')
      await expect(
        c.query(`select public.issue_orders($1::jsonb)`, [
          JSON.stringify({ restock: [{ sku: w.vendorB.skus[0], quantity: 1 }] }),
        ]),
      ).rejects.toThrow(/only procurement/i)
      await c.query('rollback to savepoint p')
    })
  })

  it('refuses a vendor granting herself another vendor', async () => {
    // The most direct privilege escalation available to a vendor.
    await db.asUser(w.vendorB.ownerUser, async (c) => {
      await c.query('savepoint p')
      await expect(
        c.query(`insert into vendor_users (vendor_id, user_id) values ($1, $2)`, [
          w.vendorA.id,
          w.vendorB.ownerUser,
        ]),
      ).rejects.toThrow(/permission denied|row-level security/i)
      await c.query('rollback to savepoint p')
    })
  })

  it('refuses a vendor promoting herself', async () => {
    await db.asUser(w.vendorB.ownerUser, async (c) => {
      await c.query('savepoint p')
      await expect(
        c.query(`update app_users set role = 'procurement_head' where id = $1`, [
          w.vendorB.ownerUser,
        ]),
      ).rejects.toThrow(/row-level security/i)
      await c.query('rollback to savepoint p')
    })
  })

  it('lets a vendor change her own name and language', async () => {
    // The permitted half of self-service. A weaver switching the portal to
    // Kannada must not need Pooja.
    const n = await db.asUser(w.vendorB.ownerUser, async (c) => {
      const res = await c.query(
        `update app_users set full_name = 'Renamed', locale = 'kn' where id = $1`,
        [w.vendorB.ownerUser],
      )
      return res.rowCount
    })
    expect(n).toBe(1)
  })
})

describe("procurement's write surface", () => {
  it('lets Pooja see every vendor and every order', async () => {
    const vendors = await db.asUser(w.pooja, (c) =>
      count(c, 'select count(*)::text as n from vendors'),
    )
    const orders = await db.asUser(w.pooja, (c) =>
      count(c, 'select count(*)::text as n from orders'),
    )
    expect(vendors).toBe(2)
    expect(orders).toBe(2)
  })

  it('lets Pooja cancel an issued order', async () => {
    const n = await db.asUser(w.pooja, async (c) => {
      const res = await c.query(`update orders set status = 'cancelled' where id = $1`, [
        w.vendorA.orderId,
      ])
      return res.rowCount
    })
    expect(n).toBe(1)
  })

  it('refuses Pooja every other write on an order she has sent', async () => {
    const attempts: { sql: string; params: unknown[] }[] = [
      { sql: `update orders set status = 'received' where id = $1`, params: [w.vendorA.orderId] },
      {
        sql: `update orders set promised_date = current_date + 99 where id = $1`,
        params: [w.vendorA.orderId],
      },
      {
        sql: `update orders set transport_docket = 'FAKE' where id = $1`,
        params: [w.vendorA.orderId],
      },
      { sql: `update orders set order_number = 'X-1' where id = $1`, params: [w.vendorA.orderId] },
      {
        sql: `update orders set vendor_id = $2 where id = $1`,
        params: [w.vendorA.orderId, w.vendorB.id],
      },
    ]

    for (const { sql, params } of attempts) {
      await db.asUser(w.pooja, async (c) => {
        await c.query('savepoint p')
        await expect(c.query(sql, params)).rejects.toThrow(
          /cancel an issued or accepted order|identity of an issued order|vendor's to set/i,
        )
        await c.query('rollback to savepoint p')
      })
    }
  })

  it('refuses Pooja rewriting the catalogue', async () => {
    // Products come from the loader, which is a script running as the owner.
    // No screen writes them, so no grant exists.
    await db.asUser(w.pooja, async (c) => {
      await c.query('savepoint p')
      await expect(
        c.query(`update products set qty_available = 99 where sku = $1`, [w.vendorA.skus[0]]),
      ).rejects.toThrow(/permission denied/i)
      await c.query('rollback to savepoint p')
    })
  })
})

describe('access revocation', () => {
  it('cuts off a suspended user immediately, not on token refresh', async () => {
    // Role and status live in the database rather than the JWT precisely so
    // revocation does not wait up to an hour for a refresh.
    const orders = await db.asUser(w.suspended, (c) =>
      count(c, 'select count(*)::text as n from orders'),
    )
    const products = await db.asUser(w.suspended, (c) =>
      count(c, 'select count(*)::text as n from products'),
    )
    expect(orders).toBe(0)
    expect(products).toBe(0)
  })

  it('cuts off a user suspended within the same request', async () => {
    await db.asAdmin(async (c) => {
      await c.query('begin')
      try {
        await c.query(`update app_users set status = 'suspended' where id = $1`, [
          w.vendorB.ownerUser,
        ])
        await c.query('set local role authenticated')
        await c.query("select set_config('request.jwt.claim.sub', $1, true)", [w.vendorB.ownerUser])
        const { rows } = await c.query('select id from orders')
        expect(rows).toEqual([])
      } finally {
        await c.query('rollback')
      }
    })
  })

  it('gives an anonymous caller nothing', async () => {
    await db.asAnon(async (c) => {
      await c.query('savepoint p')
      await expect(c.query('select id from orders')).rejects.toThrow(/permission denied/i)
      await c.query('rollback to savepoint p')
    })
  })
})

describe('the rule that must never be broken', () => {
  it('keeps sold-out draft designs in the reorder pool', async () => {
    // Shopify drafts a product the moment it sells out. A draft product is the
    // strongest reorder candidate there is, and 8,182 of the 8,891 designs in
    // the real pool are draft — a filter on shopify_status would empty this
    // screen of exactly the sarees that proved they sell.
    const pool = await db.asUser(w.vendorB.ownerUser, async (c) => {
      const { rows } = await c.query<{ sku: string; shopify_status: string }>(
        `select sku, shopify_status from products where qty_available in (0, 1) order by sku`,
      )
      return rows
    })
    expect(pool).toHaveLength(2)
    expect(pool.every((p) => p.shopify_status === 'draft')).toBe(true)
  })

  it('has no policy or function that filters on shopify_status', async () => {
    const offenders = await db.asAdmin(async (c) => {
      const { rows } = await c.query<{ what: string }>(
        `select p.proname as what
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname in ('public', 'app') and p.prosrc ilike '%shopify_status%'
          union all
         select pol.polname
           from pg_policy pol
          where pg_get_expr(pol.polqual, pol.polrelid) ilike '%shopify_status%'
             or pg_get_expr(pol.polwithcheck, pol.polrelid) ilike '%shopify_status%'`,
      )
      return rows.map((r) => r.what)
    })
    expect(offenders).toEqual([])
  })
})
