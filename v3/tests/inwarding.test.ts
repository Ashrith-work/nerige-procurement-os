/**
 * Inwarding and the support lookup — proved against Postgres.
 *
 * The receiving bench is the first thing in this schema that moves an order to
 * `received`, and it does so through a guard that until now refused that move
 * from everybody. So the questions here are about who, and when: the warehouse
 * records a parcel; a short parcel keeps the order open; a complete one closes
 * it; nobody receives an order that has not been sent; the weaver reads what
 * was received from her and writes none of it; support reads a design without
 * its cost and writes nothing; the developer reads and writes nothing.
 *
 * The pure rules in src/lib/inwarding/rules.ts are tested at the top against
 * the same cases, because the screen uses them to predict what the database
 * will decide.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { Client } from 'pg'
import { getTestDb, type TestDb } from './harness/db'
import { seedWorld, type World } from './harness/fixtures'
import {
  outstanding,
  orderCompletion,
  validateReceipt,
  wouldComplete,
  parseCount,
} from '../src/lib/inwarding/rules'
import { bucketForInward } from '../src/lib/inwarding/view'

let db: TestDb
let w: World
let warehouse: string
let support: string
let developer: string
let admin: string

/** A dispatched order for vendor A: 6 of a restock design, 3 new designs. */
let order: { id: string; restockLine: string; newDesignLine: string }

beforeAll(async () => {
  db = await getTestDb()
  w = await db.asAdmin((c) => seedWorld(c))

  const makeStaff = async (c: Client, role: string, email: string) => {
    const { rows } = await c.query<{ id: string }>(
      `insert into auth.users (email) values ($1) returning id`,
      [email],
    )
    await c.query(
      `insert into app_users (id, role, status, full_name, email)
       values ($1, $2::app_role, 'active', $3, $4)`,
      [rows[0].id, role, `Test ${role}`, email],
    )
    return rows[0].id
  }

  ;[warehouse, support, developer, admin] = await db.asAdmin(async (c) => [
    await makeStaff(c, 'warehouse_manager', 'wh@nerige.test'),
    await makeStaff(c, 'customer_support', 'cs@nerige.test'),
    await makeStaff(c, 'developer', 'dev@nerige.test'),
    await makeStaff(c, 'admin', 'owner@nerige.test'),
  ])

  // Committed, in one transaction for the deferred one-to-six refs rule. As the
  // owner with no JWT, neither order guard applies — this is setup, not the
  // thing under test.
  order = await db.asAdmin(async (c) => {
    await c.query('begin')
    try {
      const o = await c.query<{ id: string }>(
        `insert into orders (batch_id, vendor_id, status, promised_date, dispatched_at, transport_docket)
         values (gen_random_uuid(), $1, 'dispatched', current_date - 2, now() - interval '3 days', 'DKT-42')
         returning id`,
        [w.vendorA.id],
      )
      const r = await c.query<{ id: string }>(
        `insert into order_lines (order_id, line_type, sku, quantity, snapshot_title)
         values ($1, 'restock', $2, 6, 'Design 2') returning id`,
        [o.rows[0].id, w.vendorA.skus[1]],
      )
      const n = await c.query<{ id: string }>(
        `insert into order_lines (order_id, line_type, brief, quantity)
         values ($1, 'new_design', 'Brighter borders.', 3) returning id`,
        [o.rows[0].id],
      )
      await c.query(`insert into order_line_refs (order_line_id, sku) values ($1, $2)`, [
        n.rows[0].id,
        w.vendorA.skus[2],
      ])
      await c.query('commit')
      return { id: o.rows[0].id, restockLine: r.rows[0].id, newDesignLine: n.rows[0].id }
    } catch (err) {
      await c.query('rollback')
      throw err
    }
  })
}, 180_000)

afterAll(async () => {
  await db?.stop()
})

const count = async (c: Client, sql: string, params: unknown[] = []): Promise<number> => {
  const { rows } = await c.query<{ n: string }>(sql, params)
  return Number(rows[0].n)
}

/** Same helper as developer.test.ts: an error or zero rows affected is a refusal. */
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

/** Runs a statement expected to raise, returning the message. */
const raises = async (c: Client, sql: string, params: unknown[] = []): Promise<string> => {
  await c.query('savepoint e')
  try {
    await c.query(sql, params)
    await c.query('release savepoint e')
    return ''
  } catch (err) {
    await c.query('rollback to savepoint e')
    return (err as Error).message
  }
}

const RECEIVE = `select public.record_order_receipt($1, $2::jsonb, $3, $4) as r`

const receive = async (
  c: Client,
  lines: { order_line_id: string; received?: number; rejected?: number; reason?: string }[],
  opts: { orderId?: string; note?: string | null; closeShort?: boolean } = {},
) => {
  const { rows } = await c.query<{ r: { status: string; lines_recorded: number } }>(RECEIVE, [
    opts.orderId ?? order.id,
    JSON.stringify(lines),
    opts.note ?? null,
    opts.closeShort ?? false,
  ])
  return rows[0].r
}

const statusOf = async (c: Client, id: string) => {
  const { rows } = await c.query<{ status: string; received_at: string | null; received_by: string | null }>(
    'select status, received_at, received_by from orders where id = $1',
    [id],
  )
  return rows[0]
}

// -----------------------------------------------------------------------------
// The pure rules
// -----------------------------------------------------------------------------
describe('inwarding rules (pure)', () => {
  it('counts rejected pieces as arrived, and never owes on an over-delivery', () => {
    expect(outstanding({ ordered: 6, received: 4, rejected: 0 })).toBe(2)
    expect(outstanding({ ordered: 6, received: 4, rejected: 2 })).toBe(0)
    expect(outstanding({ ordered: 6, received: 7, rejected: 0 })).toBe(0)
  })

  it('reads an order as not started, partial or complete', () => {
    const lines = [
      { ordered: 6, received: 6, rejected: 0 },
      { ordered: 3, received: 1, rejected: 0 },
    ]
    expect(orderCompletion(lines, { hasParcel: false })).toBe('not_started')
    expect(orderCompletion(lines, { hasParcel: true })).toBe('partial')
    expect(orderCompletion(lines, { hasParcel: true, closedShort: true })).toBe('complete')
    expect(orderCompletion([{ ordered: 3, received: 2, rejected: 1 }], { hasParcel: true })).toBe(
      'complete',
    )
  })

  it('reports every problem a receipt has, not only the first', () => {
    const problems = validateReceipt(
      [
        { orderLineId: 'a', received: 0, rejected: 2, reason: null, note: null },
        { orderLineId: 'b', received: -1, rejected: 0, reason: null, note: null },
        { orderLineId: 'c', received: Number.NaN, rejected: 0, reason: null, note: null },
      ],
      { closeShort: true, note: '  ' },
    )
    expect(problems.map((p) => p.orderLineId)).toEqual(['a', 'b', 'c', null])
  })

  it('refuses an empty parcel unless the order is being closed short with a reason', () => {
    const empty = [{ orderLineId: 'a', received: 0, rejected: 0, reason: null, note: null }]
    expect(validateReceipt(empty, { closeShort: false, note: null })).toHaveLength(1)
    expect(validateReceipt(empty, { closeShort: true, note: 'Weaver says no more.' })).toEqual([])
  })

  it('predicts whether a parcel completes the order', () => {
    const lines = [
      { id: 'a', ordered: 6, received: 2, rejected: 0 },
      { id: 'b', ordered: 3, received: 0, rejected: 0 },
    ]
    expect(wouldComplete(lines, [{ orderLineId: 'a', received: 4, rejected: 0 }], false)).toBe(false)
    expect(
      wouldComplete(
        lines,
        [
          { orderLineId: 'a', received: 3, rejected: 1 },
          { orderLineId: 'b', received: 3, rejected: 0 },
        ],
        false,
      ),
    ).toBe(true)
    expect(wouldComplete(lines, [], true)).toBe(true)
  })

  it('sorts orders into the four piles the bench works from', () => {
    const base = {
      orderNumber: 'ORD', vendorCode: 'AAA', vendorName: 'A', issuedAt: '2026-09-01T00:00:00Z',
      promisedDate: null, dispatchedAt: null, docket: null, receivedAt: null,
      lines: [], parcels: [], completion: 'not_started' as const, piecesOrdered: 0, piecesOutstanding: 0,
    }
    const parcel = { id: 'p', receivedAt: '2026-09-14T00:00:00Z', receivedBy: null, note: null, closesOrder: false, lines: [] }
    const piles = bucketForInward(
      [
        { ...base, id: 'new', status: 'dispatched', dispatchedAt: '2026-09-10T00:00:00Z' },
        { ...base, id: 'old', status: 'dispatched', dispatchedAt: '2026-09-02T00:00:00Z' },
        { ...base, id: 'part', status: 'dispatched', dispatchedAt: '2026-09-05T00:00:00Z', parcels: [parcel] },
        { ...base, id: 'late', status: 'accepted', promisedDate: '2026-09-10' },
        { ...base, id: 'ontime', status: 'accepted', promisedDate: '2026-09-20' },
        { ...base, id: 'recent', status: 'received', receivedAt: '2026-09-14T00:00:00Z' },
        { ...base, id: 'ancient', status: 'received', receivedAt: '2026-08-01T00:00:00Z' },
      ],
      '2026-09-15',
      '2026-09-01T00:00:00Z',
    )
    expect(piles.expected.map((o) => o.id)).toEqual(['old', 'new'])
    expect(piles.partiallyReceived.map((o) => o.id)).toEqual(['part'])
    expect(piles.lateNotDispatched.map((o) => o.id)).toEqual(['late'])
    expect(piles.receivedRecently.map((o) => o.id)).toEqual(['recent'])
  })

  it('reads a blank field as zero and rubbish as not-a-number', () => {
    expect(parseCount('')).toBe(0)
    expect(parseCount(null)).toBe(0)
    expect(parseCount(' 4 ')).toBe(4)
    expect(parseCount('2.5')).toBeNaN()
    expect(parseCount('four')).toBeNaN()
  })
})

// -----------------------------------------------------------------------------
// Receiving
// -----------------------------------------------------------------------------
describe('receiving a parcel', () => {
  it('lets the warehouse manager read the order she is receiving, but not products', async () => {
    await db.asUser(warehouse, async (c) => {
      expect(await count(c, 'select count(*) as n from orders')).toBe(3)
      expect(await count(c, 'select count(*) as n from order_lines where order_id = $1', [order.id])).toBe(2)
      expect(await count(c, 'select count(*) as n from order_line_refs')).toBeGreaterThan(0)
      expect(await count(c, `select count(*) as n from vendors where code in ('AAA', 'BBB')`)).toBe(2)
      // Cost lives on products; the bench renders the order's snapshots instead.
      expect(await count(c, 'select count(*) as n from products')).toBe(0)
    })
  })

  it('records a partial receipt and keeps the order dispatched', async () => {
    await db.asUser(warehouse, async (c) => {
      const r = await receive(c, [
        { order_line_id: order.restockLine, received: 4 },
        { order_line_id: order.newDesignLine, received: 0 },
      ])
      expect(r).toMatchObject({ status: 'dispatched', lines_recorded: 1 })
      expect((await statusOf(c, order.id)).status).toBe('dispatched')

      const { rows } = await c.query<{ received_by_name: string; qty: number; q: number }>(
        `select r.received_by_name, lr.qty_received as qty, ol.quantity_received as q
           from order_receipts r
           join order_line_receipts lr on lr.receipt_id = r.id
           join order_lines ol on ol.id = lr.order_line_id
          where r.order_id = $1`,
        [order.id],
      )
      expect(rows).toEqual([{ received_by_name: 'Test warehouse_manager', qty: 4, q: 4 }])
    })
  })

  it('moves the order to received once every line is accounted for, across parcels', async () => {
    await db.asUser(warehouse, async (c) => {
      await receive(c, [{ order_line_id: order.restockLine, received: 4 }])
      const second = await receive(c, [
        { order_line_id: order.restockLine, received: 1, rejected: 1, reason: 'damaged' },
        { order_line_id: order.newDesignLine, received: 3 },
      ])
      expect(second.status).toBe('received')

      const s = await statusOf(c, order.id)
      expect(s.status).toBe('received')
      expect(s.received_at).not.toBeNull()
      expect(s.received_by).toBe(warehouse)
    })
  })

  it('lets procurement complete a receipt through the guard', async () => {
    // Admin is is_internal(), so the internal write guard fires on the RPC's
    // UPDATE — this is the one move it now permits.
    await db.asUser(admin, async (c) => {
      const r = await receive(c, [
        { order_line_id: order.restockLine, received: 6 },
        { order_line_id: order.newDesignLine, received: 3 },
      ])
      expect(r.status).toBe('received')
    })
  })

  it('closes an order short only with a reason', async () => {
    await db.asUser(warehouse, async (c) => {
      expect(
        await raises(c, RECEIVE, [order.id, JSON.stringify([]), null, true]),
      ).toMatch(/say why the order is being closed/i)

      const r = await receive(c, [{ order_line_id: order.restockLine, received: 4 }], {
        closeShort: true,
        note: 'Weaver says the last two will not be made.',
      })
      expect(r.status).toBe('received')
    })
  })

  it('refuses a rejection with no reason, an empty parcel, and a line from another order', async () => {
    await db.asUser(warehouse, async (c) => {
      expect(
        await raises(c, RECEIVE, [
          order.id,
          JSON.stringify([{ order_line_id: order.restockLine, rejected: 2 }]),
          null,
          false,
        ]),
      ).toMatch(/say why 2 piece/i)

      expect(
        await raises(c, RECEIVE, [
          order.id,
          JSON.stringify([{ order_line_id: order.restockLine, received: 0 }]),
          null,
          false,
        ]),
      ).toMatch(/nothing was entered/i)

      expect(
        await raises(c, RECEIVE, [
          order.id,
          JSON.stringify([{ order_line_id: w.vendorB.restockLineId, received: 1 }]),
          null,
          false,
        ]),
      ).toMatch(/not on this order/i)
    })
  })

  it('refuses to receive an order that has not been dispatched', async () => {
    // Decision: only `dispatched`. An issued or accepted order has no docket and
    // no dispatch date, and receiving it would overwrite the weaver's record of
    // what she sent. The fixture order is still `issued`.
    await db.asUser(warehouse, async (c) => {
      expect(
        await raises(c, RECEIVE, [
          w.vendorA.orderId,
          JSON.stringify([{ order_line_id: w.vendorA.restockLineId, received: 6 }]),
          null,
          false,
        ]),
      ).toMatch(/only a dispatched order can be received; this one is issued/i)
    })
  })

  it('refuses a second receipt on an order already received', async () => {
    await db.asUser(warehouse, async (c) => {
      await receive(c, [
        { order_line_id: order.restockLine, received: 6 },
        { order_line_id: order.newDesignLine, received: 3 },
      ])
      expect(
        await raises(c, RECEIVE, [
          order.id,
          JSON.stringify([{ order_line_id: order.restockLine, received: 1 }]),
          null,
          false,
        ]),
      ).toMatch(/this one is received/i)
    })
  })

  it('does not let procurement mark an order received by hand, even when it is accounted for', async () => {
    // The guard's new move requires received_at, and app.orders_receiving_guard()
    // refuses that column to anyone not making the whole move as themself. So a
    // bare status update is still refused with the guard's original sentence,
    // and a bare timestamp is refused too.
    await db.asUser(w.pooja, async (c) => {
      // Make the order fully accounted for underneath her, as the owner, inside
      // this rolled-back transaction — so the only thing missing is received_at.
      await c.query('set local role postgres')
      const { rows } = await c.query<{ id: string }>(
        `insert into order_receipts (order_id) values ($1) returning id`,
        [order.id],
      )
      await c.query(
        `insert into order_line_receipts (receipt_id, order_line_id, qty_received)
         values ($1, $2, 6), ($1, $3, 3)`,
        [rows[0].id, order.restockLine, order.newDesignLine],
      )
      await c.query('set local role authenticated')

      expect(
        await raises(c, `update orders set status = 'received' where id = $1`, [order.id]),
      ).toMatch(/cancel an issued or accepted order/i)
      expect(
        await raises(c, `update orders set received_at = now() where id = $1`, [order.id]),
      ).toMatch(/recorded by the receiving bench/i)
    })
  })

  it('does not let a weaver stamp her own order received', async () => {
    // She holds a table-level UPDATE on her own order (migration 006); the
    // receiving guard is what keeps the new columns out of her reach.
    await db.asUser(w.vendorA.ownerUser, async (c) => {
      expect(
        await raises(c, `update orders set received_at = now(), received_by = $2 where id = $1`, [
          order.id,
          w.vendorA.ownerUser,
        ]),
      ).toMatch(/recorded by the receiving bench/i)
    })
  })

  it('gives nobody a direct write on the receipt tables', async () => {
    for (const user of [warehouse, w.pooja, admin]) {
      await db.asUser(user, async (c) => {
        expect(
          await refused(c, `insert into order_receipts (order_id) values ($1)`, [order.id]),
        ).toBe(true)
        expect(
          await refused(c, `update order_line_receipts set qty_received = 99`),
        ).toBe(true)
        expect(await refused(c, `delete from order_receipts`)).toBe(true)
      })
    }
  })
})

// -----------------------------------------------------------------------------
// The weaver
// -----------------------------------------------------------------------------
describe('the weaver and her receipts', () => {
  it('cannot record a receipt, even on her own dispatched order', async () => {
    await db.asUser(w.vendorA.ownerUser, async (c) => {
      expect(
        await raises(c, RECEIVE, [
          order.id,
          JSON.stringify([{ order_line_id: order.restockLine, received: 6 }]),
          null,
          false,
        ]),
      ).toMatch(/only the warehouse, procurement or the owner/i)
      expect(
        await refused(c, `insert into order_receipts (order_id) values ($1)`, [order.id]),
      ).toBe(true)
    })
  })

  it('sees what was received from her, and nothing received from anyone else', async () => {
    await db.asUser(w.vendorB.ownerUser, async (c) => {
      const { rows } = await c.query<{ order_id: string }>('select order_id from order_receipts')
      expect(rows.map((r) => r.order_id)).toEqual([w.vendorB.orderId])
      expect(await count(c, 'select count(*) as n from order_line_receipts')).toBe(1)
    })
  })

  it('sees a receipt the warehouse records against her order', async () => {
    await db.asUser(warehouse, async (c) => {
      await receive(c, [{ order_line_id: order.restockLine, received: 2 }])
      // Same transaction, now as the weaver.
      await c.query("select set_config('request.jwt.claim.sub', $1, true)", [w.vendorA.ownerUser])
      expect(await count(c, 'select count(*) as n from order_receipts where order_id = $1', [order.id])).toBe(1)
      await c.query("select set_config('request.jwt.claim.sub', $1, true)", [w.vendorB.ownerUser])
      expect(await count(c, 'select count(*) as n from order_receipts where order_id = $1', [order.id])).toBe(0)
    })
  })
})

// -----------------------------------------------------------------------------
// Customer support's lookup
// -----------------------------------------------------------------------------
describe('customer support lookup', () => {
  it('finds a design by SKU fragment, title and Unique Code, without its cost', async () => {
    await db.asUser(support, async (c) => {
      const bySku = await c.query('select * from public.lookup_products($1)', ['aaa-vint'])
      expect(bySku.rows.map((r) => r.sku).sort()).toEqual([...w.vendorA.skus].sort())
      expect(Object.keys(bySku.rows[0])).not.toContain('cost')

      const byTitle = await c.query('select * from public.lookup_products($1)', ['Design 3'])
      expect(byTitle.rows).toHaveLength(2)

      // seq 101 is the first design of each weaver in the fixture.
      const byCode = await c.query('select sku from public.lookup_products($1)', ['101'])
      expect(byCode.rows.map((r) => r.sku).sort()).toEqual([w.vendorA.skus[0], w.vendorB.skus[0]].sort())

      // A LIKE wildcard typed by hand matches itself, not everything.
      const wild = await c.query('select sku from public.lookup_products($1)', ['%%'])
      expect(wild.rows).toHaveLength(0)
    })
  })

  it('shows one design with stock, sales, open orders and no cost', async () => {
    await db.asUser(support, async (c) => {
      const { rows } = await c.query<{ r: Record<string, unknown> }>(
        'select public.lookup_product($1) as r',
        [w.vendorA.skus[1]],
      )
      const r = rows[0].r as {
        product: Record<string, unknown>
        recent_sales: unknown[]
        open_orders: { status: string; quantity: number; promised_date: string }[]
      }
      expect(r.product.sku).toBe(w.vendorA.skus[1])
      expect(r.product).not.toHaveProperty('cost')
      expect(r.recent_sales.length).toBe(1)
      expect(r.open_orders).toHaveLength(1)
      expect(r.open_orders[0]).toMatchObject({ status: 'dispatched', quantity: 6 })

      const missing = await c.query('select public.lookup_product($1) as r', ['NOPE-1'])
      expect(missing.rows[0].r).toBeNull()
    })
  })

  it('reads no table directly and writes nothing', async () => {
    await db.asUser(support, async (c) => {
      expect(await count(c, 'select count(*) as n from products')).toBe(0)
      expect(await count(c, 'select count(*) as n from orders')).toBe(0)
      expect(await count(c, 'select count(*) as n from sku_sales_daily')).toBe(0)
      expect(await count(c, 'select count(*) as n from order_receipts')).toBe(0)
      // Migration 037: intake rows carry cost_price, and RLS cannot hide a column.
      expect(await count(c, 'select count(*) as n from product_intakes')).toBe(0)

      expect(
        await raises(c, RECEIVE, [
          order.id,
          JSON.stringify([{ order_line_id: order.restockLine, received: 1 }]),
          null,
          false,
        ]),
      ).toMatch(/only the warehouse/i)
      expect(await refused(c, `insert into order_receipts (order_id) values ($1)`, [order.id])).toBe(true)
      expect(await refused(c, `update products set manual_image_url = 'x'`)).toBe(true)
    })
  })

  it('still sees intake status through the lookup, and the warehouse still reads intakes', async () => {
    await db.asUser(support, async (c) => {
      const { rows } = await c.query<{ r: Record<string, unknown> }>('select public.lookup_product($1) as r', [
        w.vendorA.skus[0],
      ])
      expect(rows[0].r).not.toBeNull()
    })
    await db.asUser(warehouse, async (c) => {
      expect(await count(c, 'select count(*) as n from product_intakes')).toBeGreaterThan(0)
    })
  })

  it('is not a way for a weaver to search every other weaver', async () => {
    await db.asUser(w.vendorB.ownerUser, async (c) => {
      expect(await raises(c, 'select * from public.lookup_products($1)', ['AAA'])).toMatch(
        /for nerige staff/i,
      )
      expect(await raises(c, 'select public.lookup_product($1)', [w.vendorA.skus[0]])).toMatch(
        /for nerige staff/i,
      )
    })
  })
})

// -----------------------------------------------------------------------------
// The developer
// -----------------------------------------------------------------------------
describe('the developer on inwarding and lookup', () => {
  it('reads receipts and the lookup', async () => {
    await db.asUser(developer, async (c) => {
      expect(await count(c, 'select count(*) as n from order_receipts')).toBe(2)
      expect(await count(c, 'select count(*) as n from order_line_receipts')).toBe(2)
      const { rows } = await c.query('select sku from public.lookup_products($1)', ['BBB'])
      expect(rows).toHaveLength(3)
    })
  })

  it('cannot record a receipt or write the receipt tables', async () => {
    await db.asUser(developer, async (c) => {
      expect(
        await raises(c, RECEIVE, [
          order.id,
          JSON.stringify([{ order_line_id: order.restockLine, received: 6 }]),
          null,
          false,
        ]),
      ).toMatch(/only the warehouse/i)
      expect(await refused(c, `insert into order_receipts (order_id) values ($1)`, [order.id])).toBe(true)
    })
  })
})
