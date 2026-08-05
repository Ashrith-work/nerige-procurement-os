/**
 * PROCUREMENT WORKFLOW SUITE — order → receipt → bill.
 *
 * The isolation suite proves vendors cannot see each other. This one proves the
 * process itself holds: that a draft order stays private, that a vendor cannot
 * quietly reprice the order they were sent, that a count posts once and then
 * becomes evidence, and that nobody but the Founder can release money.
 *
 * Everything runs as `authenticated` with a real JWT subject, because the rules
 * under test live in triggers that read app.current_role(). Running them as the
 * bootstrap superuser would exercise the trusted path and prove nothing.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { Client } from 'pg'
import { getTestDb, type TestDb } from './harness/db'
import { seedWorld, type World } from './harness/fixtures'

let db: TestDb
let w: World

beforeAll(async () => {
  db = await getTestDb()
  w = await db.asAdmin((c) => seedWorld(c))
})

afterAll(async () => {
  await db?.stop()
})

interface Scenario {
  c: Client
  /** Switch the session to a given user, or to the privileged setup role. */
  as(userId: string | null): Promise<void>
  /** Assert a statement is refused, without poisoning the enclosing transaction. */
  refuses(sql: string, params: unknown[], pattern: RegExp): Promise<void>
}

/**
 * Runs a multi-actor scenario inside one rolled-back transaction.
 *
 * A single flow legitimately involves three different people — Procurement
 * issues, the vendor dispatches, the warehouse counts — so unlike the isolation
 * suite these tests need to change identity mid-transaction rather than pick
 * one at the start.
 */
async function scenario<T>(fn: (s: Scenario) => Promise<T>): Promise<T> {
  const c = db.client
  await c.query('begin')

  const s: Scenario = {
    c,
    async as(userId) {
      // RESET ROLE returns to the session user (the privileged bootstrap role),
      // which is how a scenario gets back to fixture-setup rights.
      await c.query('reset role')
      await c.query("select set_config('request.jwt.claim.sub', $1, true)", [userId ?? ''])
      if (userId !== null) await c.query('set local role authenticated')
    },
    async refuses(sql, params, pattern) {
      await c.query('savepoint probe')
      try {
        await c.query(sql, params)
        throw new Error(`Expected rejection matching ${pattern}, but the statement succeeded`)
      } catch (err) {
        expect((err as Error).message).toMatch(pattern)
      } finally {
        await c.query('rollback to savepoint probe')
      }
    },
  }

  try {
    return await fn(s)
  } finally {
    await c.query('rollback')
  }
}

describe('placing an order', () => {
  it('numbers a purchase order without the caller supplying one', async () => {
    await scenario(async (s) => {
      await s.as(w.procurementHead)
      const { rows } = await s.c.query<{ po_number: string; status: string }>(
        `insert into purchase_orders (vendor_id, title) values ($1, 'Trial')
         returning po_number, status`,
        [w.vendorA.id],
      )
      expect(rows[0].po_number).toMatch(/^PO-\d{4}-\d{4}$/)
      expect(rows[0].status).toBe('draft')
    })
  })

  it('keeps a draft order invisible to the vendor, and reveals it on issue', async () => {
    await scenario(async (s) => {
      await s.as(w.procurementHead)
      const { rows } = await s.c.query<{ id: string }>(
        `insert into purchase_orders (vendor_id, title) values ($1, 'Not sent yet') returning id`,
        [w.vendorA.id],
      )
      const poId = rows[0].id
      await s.c.query(
        `insert into purchase_order_lines
           (purchase_order_id, kind, product_id, quantity, unit_price)
         values ($1, 'restock', $2, 10, 1450.00)`,
        [poId, w.vendorA.productIds[0]],
      )

      await s.as(w.vendorA.ownerUser)
      const hidden = await s.c.query('select id from purchase_orders where id = $1', [poId])
      expect(hidden.rows).toEqual([])
      // The lines must vanish with the header, or the order leaks line by line.
      const hiddenLines = await s.c.query(
        'select id from purchase_order_lines where purchase_order_id = $1',
        [poId],
      )
      expect(hiddenLines.rows).toEqual([])

      await s.as(w.procurementHead)
      await s.c.query(`update purchase_orders set status = 'issued' where id = $1`, [poId])

      await s.as(w.vendorA.ownerUser)
      const visible = await s.c.query('select id from purchase_orders where id = $1', [poId])
      expect(visible.rows).toHaveLength(1)
      const visibleLines = await s.c.query(
        'select id from purchase_order_lines where purchase_order_id = $1',
        [poId],
      )
      expect(visibleLines.rows).toHaveLength(1)
    })
  })

  it('refuses to issue an order with no lines on it', async () => {
    await scenario(async (s) => {
      await s.as(w.procurementHead)
      const { rows } = await s.c.query<{ id: string }>(
        `insert into purchase_orders (vendor_id, title) values ($1, 'Empty') returning id`,
        [w.vendorA.id],
      )
      await s.refuses(
        `update purchase_orders set status = 'issued' where id = $1`,
        [rows[0].id],
        /has no lines and cannot be issued/i,
      )
    })
  })

  it("refuses a line quoting another vendor's SKU", async () => {
    // Otherwise Vendor A's order could carry Vendor B's product — and Vendor B's
    // agreed price — straight into the portal.
    await scenario(async (s) => {
      await s.as(w.procurementHead)
      const { rows } = await s.c.query<{ id: string }>(
        `insert into purchase_orders (vendor_id, title) values ($1, 'Mixed up') returning id`,
        [w.vendorA.id],
      )
      await s.refuses(
        `insert into purchase_order_lines (purchase_order_id, kind, product_id, quantity, unit_price)
         values ($1, 'restock', $2, 5, 100)`,
        [rows[0].id, w.vendorB.productIds[0]],
        /does not belong to the vendor on this purchase order/i,
      )
    })
  })

  it('holds the two line kinds apart: a brief has no SKU, a restock must have one', async () => {
    await scenario(async (s) => {
      await s.as(w.procurementHead)
      const { rows } = await s.c.query<{ id: string }>(
        `insert into purchase_orders (vendor_id) values ($1) returning id`,
        [w.vendorA.id],
      )
      const poId = rows[0].id

      await s.refuses(
        `insert into purchase_order_lines (purchase_order_id, kind, quantity, unit_price)
         values ($1, 'restock', 5, 100)`,
        [poId],
        /po_lines_restock_needs_product/i,
      )

      await s.refuses(
        `insert into purchase_order_lines (purchase_order_id, kind, quantity, unit_price)
         values ($1, 'new_design', 5, 100)`,
        [poId],
        /po_lines_new_design_needs_brief/i,
      )

      // The brief on its own is enough, and that is the point: the SKU does not
      // exist yet because the saree does not exist yet.
      const ok = await s.c.query(
        `insert into purchase_order_lines
           (purchase_order_id, kind, description, colours, quantity, unit_price)
         values ($1, 'new_design', 'Teal body, gold temple border', array['Teal'], 25, 1600)
         returning id, line_no`,
        [poId],
      )
      expect(ok.rows[0].line_no).toBe(1)
    })
  })

  it('keeps the order total equal to the sum of its lines', async () => {
    await scenario(async (s) => {
      await s.as(w.procurementHead)
      const { rows } = await s.c.query<{ id: string }>(
        `insert into purchase_orders (vendor_id) values ($1) returning id`,
        [w.vendorA.id],
      )
      const poId = rows[0].id
      await s.c.query(
        `insert into purchase_order_lines
           (purchase_order_id, kind, product_id, quantity, unit_price, gst_rate)
         values ($1, 'restock', $2, 10, 1000.00, 5)`,
        [poId, w.vendorA.productIds[0]],
      )

      const after = await s.c.query<{ subtotal_amount: string; tax_amount: string; total_amount: string }>(
        'select subtotal_amount, tax_amount, total_amount from purchase_orders where id = $1',
        [poId],
      )
      expect(after.rows[0].subtotal_amount).toBe('10000.00')
      expect(after.rows[0].tax_amount).toBe('500.00')
      expect(after.rows[0].total_amount).toBe('10500.00')
    })
  })

  it('emits exactly one issue notification however many times the row is touched', async () => {
    await scenario(async (s) => {
      await s.as(w.procurementHead)
      const { rows } = await s.c.query<{ id: string }>(
        `insert into purchase_orders (vendor_id) values ($1) returning id`,
        [w.vendorA.id],
      )
      const poId = rows[0].id
      await s.c.query(
        `insert into purchase_order_lines (purchase_order_id, kind, product_id, quantity, unit_price)
         values ($1, 'restock', $2, 5, 1450)`,
        [poId, w.vendorA.productIds[0]],
      )
      await s.c.query(`update purchase_orders set status = 'issued' where id = $1`, [poId])
      // A second write that does not change status must not re-notify.
      await s.c.query(`update purchase_orders set status = 'issued' where id = $1`, [poId])

      await s.as(null)
      const { rows: events } = await s.c.query<{ n: string }>(
        `select count(*)::text as n from events
          where topic = 'purchase_order.issued' and aggregate_id = $1`,
        [poId],
      )
      expect(Number(events[0].n)).toBe(1)

      // And the 48-hour chase is queued for the future rather than sent now.
      const { rows: chase } = await s.c.query<{ available_at: Date; occurred_at: Date }>(
        `select available_at, occurred_at from events
          where topic = 'purchase_order.acknowledgement_overdue' and aggregate_id = $1`,
        [poId],
      )
      expect(chase).toHaveLength(1)
      expect(chase[0].available_at.getTime()).toBeGreaterThan(chase[0].occurred_at.getTime())
    })
  })

  it('stamps ordering history onto the catalogue when the order goes out', async () => {
    await scenario(async (s) => {
      await s.as(w.procurementHead)
      const { rows } = await s.c.query<{ id: string }>(
        `insert into purchase_orders (vendor_id) values ($1) returning id`,
        [w.vendorA.id],
      )
      await s.c.query(
        `insert into purchase_order_lines (purchase_order_id, kind, product_id, quantity, unit_price)
         values ($1, 'restock', $2, 7, 1450)`,
        [rows[0].id, w.vendorA.productIds[1]],
      )
      await s.c.query(`update purchase_orders set status = 'issued' where id = $1`, [rows[0].id])

      const { rows: product } = await s.c.query<{
        last_ordered_at: Date | null
        units_ordered_total: number
      }>('select last_ordered_at, units_ordered_total from products where id = $1', [
        w.vendorA.productIds[1],
      ])
      expect(product[0].last_ordered_at).not.toBeNull()
      expect(product[0].units_ordered_total).toBeGreaterThanOrEqual(7)
    })
  })
})

describe('what a vendor may do to their own order', () => {
  it('lets the vendor acknowledge and commit to their own date', async () => {
    await scenario(async (s) => {
      await s.as(w.vendorA.ownerUser)
      const res = await s.c.query(
        `update purchase_orders
            set status = 'acknowledged', promised_date = current_date + 21
          where id = $1`,
        [w.vendorA.poId],
      )
      expect(res.rowCount).toBe(1)

      const { rows } = await s.c.query<{ acknowledged_by: string; acknowledged_at: Date }>(
        'select acknowledged_by, acknowledged_at from purchase_orders where id = $1',
        [w.vendorA.poId],
      )
      // Stamped by the trigger, not by the client, so it is true regardless of
      // which screen performed the update.
      expect(rows[0].acknowledged_by).toBe(w.vendorA.ownerUser)
      expect(rows[0].acknowledged_at).not.toBeNull()
    })
  })

  it('lets the vendor record dispatch details', async () => {
    await scenario(async (s) => {
      await s.as(w.vendorA.ownerUser)
      await s.c.query(`update purchase_orders set status = 'acknowledged' where id = $1`, [
        w.vendorA.poId,
      ])
      const res = await s.c.query(
        `update purchase_orders
            set status = 'dispatched', transporter = 'VRL Logistics',
                docket_number = 'VRL-88213', parcel_count = 3
          where id = $1`,
        [w.vendorA.poId],
      )
      expect(res.rowCount).toBe(1)
    })
  })

  it('silently refuses a vendor rewriting the price or quantity they were sent', async () => {
    // The critical column-guard test. RLS is row-level: the UPDATE policy lets
    // the vendor touch this row at all, so without the pin trigger a crafted
    // request could rewrite what we are about to be billed for.
    await scenario(async (s) => {
      await s.as(w.vendorA.ownerUser)
      await s.c.query(
        `update purchase_orders
            set status = 'acknowledged', total_amount = 1, subtotal_amount = 1,
                required_by = current_date, instructions = 'ignore the labels'
          where id = $1`,
        [w.vendorA.poId],
      )

      await s.as(w.procurementHead)
      const { rows } = await s.c.query<{
        total_amount: string
        instructions: string | null
        status: string
      }>('select total_amount, instructions, status from purchase_orders where id = $1', [
        w.vendorA.poId,
      ])
      // The acknowledgement went through; everything else was pinned back.
      expect(rows[0].status).toBe('acknowledged')
      expect(Number(rows[0].total_amount)).toBeGreaterThan(1)
      expect(rows[0].instructions).toBeNull()
    })
  })

  it('refuses a vendor moving an order to a state that is not theirs to set', async () => {
    await scenario(async (s) => {
      await s.as(w.vendorA.ownerUser)
      await s.refuses(
        `update purchase_orders set status = 'received' where id = $1`,
        [w.vendorA.poId],
        /vendor cannot move a purchase order/i,
      )
      await s.refuses(
        `update purchase_orders set status = 'cancelled', cancellation_reason = 'no' where id = $1`,
        [w.vendorA.poId],
        /vendor cannot move a purchase order/i,
      )
    })
  })

  it('refuses a vendor editing the lines of their order', async () => {
    await scenario(async (s) => {
      await s.as(w.vendorA.ownerUser)
      const res = await s.c.query(
        `update purchase_order_lines set quantity = 1, unit_price = 1 where id = $1`,
        [w.vendorA.restockLineId],
      )
      expect(res.rowCount).toBe(0)
    })
  })

  it('hides internal notes from the vendor while showing them the thread', async () => {
    await scenario(async (s) => {
      await s.as(w.vendorA.ownerUser)
      const { rows } = await s.c.query<{ is_internal: boolean }>(
        'select is_internal from purchase_order_messages where purchase_order_id = $1',
        [w.vendorA.poId],
      )
      expect(rows).toHaveLength(1)
      expect(rows[0].is_internal).toBe(false)
    })
  })

  it('refuses a vendor posting a note the vendor could not then read', async () => {
    await scenario(async (s) => {
      await s.as(w.vendorA.ownerUser)
      await s.refuses(
        `insert into purchase_order_messages (purchase_order_id, vendor_id, author_id, body, is_internal)
         values ($1, $2, $3, 'sneaky', true)`,
        [w.vendorA.poId, w.vendorA.id, w.vendorA.ownerUser],
        /row-level security/i,
      )
    })
  })

  it('lets the vendor ask a question on their own order', async () => {
    await scenario(async (s) => {
      await s.as(w.vendorA.ownerUser)
      const res = await s.c.query(
        `insert into purchase_order_messages (purchase_order_id, vendor_id, author_id, body)
         values ($1, $2, $3, 'Can we send 20 now and 20 next week?')`,
        [w.vendorA.poId, w.vendorA.id, w.vendorA.ownerUser],
      )
      expect(res.rowCount).toBe(1)
    })
  })
})

describe('counting stock in', () => {
  it('rolls a posted receipt onto the order and advances its status', async () => {
    await scenario(async (s) => {
      await s.as(w.warehouseManager)
      await s.c.query(`update goods_receipts set status = 'posted' where id = $1`, [w.vendorA.grnId])

      const { rows: line } = await s.c.query<{ quantity_received: number }>(
        'select quantity_received from purchase_order_lines where id = $1',
        [w.vendorA.restockLineId],
      )
      expect(line[0].quantity_received).toBe(38)

      const { rows: po } = await s.c.query<{ status: string }>(
        'select status from purchase_orders where id = $1',
        [w.vendorA.poId],
      )
      // 2 short on the restock line and the whole new-design line outstanding.
      expect(po[0].status).toBe('partially_received')
    })
  })

  it('closes the order once every line is accounted for', async () => {
    await scenario(async (s) => {
      await s.as(w.warehouseManager)
      await s.c.query(
        `update goods_receipt_lines set quantity_received = 40 where goods_receipt_id = $1`,
        [w.vendorA.grnId],
      )
      await s.c.query(
        `insert into goods_receipt_lines
           (goods_receipt_id, purchase_order_line_id, quantity_ordered, quantity_received)
         values ($1, $2, 30, 30)`,
        [w.vendorA.grnId, w.vendorA.newDesignLineId],
      )
      await s.c.query(`update goods_receipts set status = 'posted' where id = $1`, [w.vendorA.grnId])

      const { rows } = await s.c.query<{ status: string; received_at: Date | null }>(
        'select status, received_at from purchase_orders where id = $1',
        [w.vendorA.poId],
      )
      expect(rows[0].status).toBe('received')
      expect(rows[0].received_at).not.toBeNull()
    })
  })

  it('treats a posted receipt as evidence and refuses any further edit', async () => {
    await scenario(async (s) => {
      await s.as(w.warehouseManager)
      await s.c.query(`update goods_receipts set status = 'posted' where id = $1`, [w.vendorA.grnId])

      await s.refuses(
        `update goods_receipts set notes = 'actually it was 40' where id = $1`,
        [w.vendorA.grnId],
        /is posted and cannot be changed/i,
      )
      await s.refuses(
        `insert into goods_receipt_lines
           (goods_receipt_id, purchase_order_line_id, quantity_ordered, quantity_received)
         values ($1, $2, 30, 30)`,
        [w.vendorA.grnId, w.vendorA.newDesignLineId],
        /can no longer be edited/i,
      )
    })
  })

  it('snapshots the ordered quantity and owner from the order, not from the caller', async () => {
    // The receiving screen sends only a count. Everything that decides who can
    // read the row, and what it is being measured against, is taken from the
    // order — so a crafted request cannot claim a different vendor or move the
    // goalposts on what "short" means.
    await scenario(async (s) => {
      await s.as(w.warehouseManager)
      const { rows } = await s.c.query<{ id: string }>(
        `insert into goods_receipts (vendor_id, purchase_order_id) values ($1, $2) returning id`,
        [w.vendorA.id, w.vendorA.poId],
      )
      await s.c.query(
        `insert into goods_receipt_lines
           (goods_receipt_id, vendor_id, purchase_order_line_id, quantity_ordered, quantity_received)
         values ($1, $2, $3, 0, 5)`,
        // Both lies: vendor B's id, and an ordered quantity of zero.
        [rows[0].id, w.vendorB.id, w.vendorA.restockLineId],
      )

      const { rows: line } = await s.c.query<{ quantity_ordered: number; vendor_id: string }>(
        'select quantity_ordered, vendor_id from goods_receipt_lines where goods_receipt_id = $1',
        [rows[0].id],
      )
      expect(line[0].quantity_ordered).toBe(40)
      expect(line[0].vendor_id).toBe(w.vendorA.id)
    })
  })

  it('refuses to post a receipt with nothing counted on it', async () => {
    await scenario(async (s) => {
      await s.as(w.warehouseManager)
      const { rows } = await s.c.query<{ id: string }>(
        `insert into goods_receipts (vendor_id, purchase_order_id) values ($1, $2) returning id`,
        [w.vendorA.id, w.vendorA.poId],
      )
      await s.refuses(
        `update goods_receipts set status = 'posted' where id = $1`,
        [rows[0].id],
        /has no counted lines/i,
      )
    })
  })

  it("refuses to count a line that belongs to a different order", async () => {
    await scenario(async (s) => {
      await s.as(w.warehouseManager)
      await s.refuses(
        `insert into goods_receipt_lines
           (goods_receipt_id, purchase_order_line_id, quantity_ordered, quantity_received)
         values ($1, $2, 10, 10)`,
        [w.vendorA.grnId, w.vendorB.restockLineId],
        /belongs to a different purchase order|row-level security/i,
      )
    })
  })

  it('shows the vendor what we counted, so a shortfall is a shared document', async () => {
    await scenario(async (s) => {
      await s.as(w.warehouseManager)
      await s.c.query(`update goods_receipts set status = 'posted' where id = $1`, [w.vendorA.grnId])

      await s.as(w.vendorA.ownerUser)
      const { rows } = await s.c.query<{ quantity_received: number; quantity_ordered: number }>(
        `select quantity_received, quantity_ordered from goods_receipt_lines
          where goods_receipt_id = $1`,
        [w.vendorA.grnId],
      )
      expect(rows).toHaveLength(1)
      expect(rows[0].quantity_received).toBe(38)
      expect(rows[0].quantity_ordered).toBe(40)
    })
  })

  it('keeps the warehouse out of everything except recording receipt', async () => {
    await scenario(async (s) => {
      await s.as(w.warehouseManager)
      // Cannot issue, cannot cancel — the transition guard names the reason.
      await s.refuses(
        `update purchase_orders set status = 'cancelled', cancellation_reason = 'x' where id = $1`,
        [w.vendorA.poId],
        /warehouse can only record receipt|row-level security/i,
      )
      // Cannot see bills at all.
      const bills = await s.c.query('select id from vendor_bills')
      expect(bills.rows).toEqual([])
    })
  })
})

describe('the bill', () => {
  it('derives the due date from the vendor agreed terms rather than trusting input', async () => {
    await scenario(async (s) => {
      await s.as(null)
      const { rows } = await s.c.query<{ due_date: Date; bill_date: Date; terms: number }>(
        `select b.due_date, b.bill_date, v.payment_terms_days as terms
           from vendor_bills b join vendors v on v.id = b.vendor_id
          where b.id = $1`,
        [w.vendorA.billId],
      )
      const days =
        (rows[0].due_date.getTime() - rows[0].bill_date.getTime()) / (1000 * 60 * 60 * 24)
      expect(days).toBe(rows[0].terms)
    })
  })

  it('computes the three-way variance against what was actually counted in', async () => {
    await scenario(async (s) => {
      await s.as(w.warehouseManager)
      await s.c.query(`update goods_receipts set status = 'posted' where id = $1`, [w.vendorA.grnId])

      await s.as(w.procurementHead)
      // Touching the bill re-snapshots the match while it is still under review.
      await s.c.query(`update vendor_bills set status = 'under_review' where id = $1`, [
        w.vendorA.billId,
      ])

      const { rows } = await s.c.query<{
        matched_received_value: string
        variance_amount: string
        total_amount: string
      }>(
        'select matched_received_value, variance_amount, total_amount from vendor_bills where id = $1',
        [w.vendorA.billId],
      )

      // 38 pieces at 1450 + 5% GST = 57,855 received against a 60,900 bill.
      expect(Number(rows[0].matched_received_value)).toBeCloseTo(57855, 2)
      expect(Number(rows[0].variance_amount)).toBeCloseTo(3045, 2)
    })
  })

  it('refuses a second bill carrying a number the vendor has already used', async () => {
    await scenario(async (s) => {
      await s.as(w.vendorA.ownerUser)
      await s.refuses(
        `insert into vendor_bills
           (vendor_id, purchase_order_id, bill_number, bill_date,
            subtotal_amount, tax_amount, total_amount, document_id)
         values ($1, $2, 'SHAN-0001', current_date, 100, 5, 105, $3)`,
        [w.vendorA.id, w.vendorA.poId, w.vendorA.billDocId],
        /duplicate key value|vendor_bills_number_per_vendor/i,
      )
    })
  })

  it('refuses a bill whose stated total does not add up', async () => {
    await scenario(async (s) => {
      await s.as(w.vendorA.ownerUser)
      await s.refuses(
        `insert into vendor_bills
           (vendor_id, purchase_order_id, bill_number, bill_date,
            subtotal_amount, tax_amount, total_amount, document_id)
         values ($1, $2, 'SHAN-9999', current_date, 100, 5, 999, $3)`,
        [w.vendorA.id, w.vendorA.poId, w.vendorA.billDocId],
        /vendor_bills_total_adds_up/i,
      )
    })
  })

  it("refuses a bill attached to another vendor's document", async () => {
    await scenario(async (s) => {
      await s.as(w.procurementHead)
      await s.refuses(
        `insert into vendor_bills
           (vendor_id, purchase_order_id, bill_number, bill_date,
            subtotal_amount, tax_amount, total_amount, document_id)
         values ($1, $2, 'SHAN-7777', current_date, 100, 5, 105, $3)`,
        [w.vendorA.id, w.vendorA.poId, w.vendorB.billDocId],
        /does not belong to this vendor/i,
      )
    })
  })

  it('lets a vendor correct their own bill until someone starts reviewing it', async () => {
    await scenario(async (s) => {
      await s.as(w.vendorA.ownerUser)
      const fixed = await s.c.query(
        `update vendor_bills set subtotal_amount = 55000, tax_amount = 2750, total_amount = 57750
          where id = $1`,
        [w.vendorA.billId],
      )
      expect(fixed.rowCount).toBe(1)

      await s.as(w.procurementHead)
      await s.c.query(`update vendor_bills set status = 'under_review' where id = $1`, [
        w.vendorA.billId,
      ])

      await s.as(w.vendorA.ownerUser)
      // Now frozen: the figures cannot move under a review that is in progress.
      await s.refuses(
        `update vendor_bills set subtotal_amount = 1, tax_amount = 0, total_amount = 1 where id = $1`,
        [w.vendorA.billId],
        /can no longer be edited|row-level security/i,
      )
    })
  })

  it('refuses a vendor approving or settling their own bill', async () => {
    await scenario(async (s) => {
      await s.as(w.vendorA.ownerUser)
      // Both the transition that would be legal for staff (starting the review)
      // and the one that never is. A vendor is refused on the grounds of who
      // they are, not on which transition they picked.
      for (const target of ['under_review', 'approved']) {
        await s.refuses(
          `update vendor_bills set status = $2 where id = $1`,
          [w.vendorA.billId, target],
          /vendor cannot change the status of a bill/i,
        )
      }
      // And cannot forge the settlement fields directly either.
      await s.c.query(
        `update vendor_bills set paid_at = now(), payment_reference = 'PAID' where id = $1`,
        [w.vendorA.billId],
      )
      await s.as(w.founder)
      const { rows } = await s.c.query<{ paid_at: Date | null; payment_reference: string | null }>(
        'select paid_at, payment_reference from vendor_bills where id = $1',
        [w.vendorA.billId],
      )
      expect(rows[0].paid_at).toBeNull()
      expect(rows[0].payment_reference).toBeNull()
    })
  })

  it('lets Procurement review but reserves approval for the Founder', async () => {
    await scenario(async (s) => {
      await s.as(w.procurementHead)
      const reviewed = await s.c.query(
        `update vendor_bills set status = 'under_review' where id = $1`,
        [w.vendorA.billId],
      )
      expect(reviewed.rowCount).toBe(1)

      await s.refuses(
        `update vendor_bills set status = 'approved' where id = $1`,
        [w.vendorA.billId],
        /only the founder can approve/i,
      )

      await s.as(w.founder)
      const approved = await s.c.query(
        `update vendor_bills set status = 'approved' where id = $1`,
        [w.vendorA.billId],
      )
      expect(approved.rowCount).toBe(1)

      const { rows } = await s.c.query<{ approved_by: string }>(
        'select approved_by from vendor_bills where id = $1',
        [w.vendorA.billId],
      )
      expect(rows[0].approved_by).toBe(w.founder)
    })
  })

  it('refuses to skip review and approve a bill nobody has looked at', async () => {
    await scenario(async (s) => {
      await s.as(w.founder)
      await s.refuses(
        `update vendor_bills set status = 'approved' where id = $1`,
        [w.vendorA.billId],
        /cannot go from submitted to approved/i,
      )
    })
  })

  it('closes the purchase order when the bill is settled', async () => {
    await scenario(async (s) => {
      await s.as(w.warehouseManager)
      await s.c.query(`update goods_receipts set status = 'posted' where id = $1`, [w.vendorA.grnId])

      await s.as(w.founder)
      await s.c.query(`update vendor_bills set status = 'under_review' where id = $1`, [
        w.vendorA.billId,
      ])
      await s.c.query(`update vendor_bills set status = 'approved' where id = $1`, [w.vendorA.billId])
      await s.c.query(
        `update vendor_bills set status = 'paid', payment_reference = 'NEFT-2231' where id = $1`,
        [w.vendorA.billId],
      )

      const { rows } = await s.c.query<{ status: string; closed_at: Date | null }>(
        'select status, closed_at from purchase_orders where id = $1',
        [w.vendorA.poId],
      )
      expect(rows[0].status).toBe('closed')
      expect(rows[0].closed_at).not.toBeNull()
    })
  })
})

describe('the catalogue the vendor prints from', () => {
  it('gives a vendor their own SKU codes and nobody else’s', async () => {
    await scenario(async (s) => {
      await s.as(w.vendorA.ownerUser)
      const { rows } = await s.c.query<{ sku: string }>('select sku from products order by sku')
      expect(rows.map((r) => r.sku)).toEqual(['shanwb14090', 'shanwb14091'])
    })
  })

  it('matches a SKU regardless of the case it was typed in', async () => {
    // The codes are written by hand on labels and read back by eye. A lookup
    // that misses because someone typed capitals is a lookup nobody trusts.
    await scenario(async (s) => {
      await s.as(w.vendorA.ownerUser)
      const { rows } = await s.c.query('select id from products where sku = $1', ['SHANWB14090'])
      expect(rows).toHaveLength(1)
    })
  })

  it('refuses a vendor inventing their own SKU', async () => {
    await scenario(async (s) => {
      await s.as(w.vendorA.ownerUser)
      await s.refuses(
        `insert into products (vendor_id, sku, title) values ($1, 'shanxx00001', 'Mine')`,
        [w.vendorA.id],
        /row-level security/i,
      )
    })
  })

  it("refuses a product borrowing another vendor's series", async () => {
    await scenario(async (s) => {
      await s.as(w.procurementHead)
      await s.refuses(
        `insert into products (vendor_id, series_id, sku, title)
         values ($1, $2, 'shanzz00001', 'Cross wired')`,
        [w.vendorA.id, w.vendorB.seriesId],
        /cannot belong to a series owned by a different vendor/i,
      )
    })
  })
})
