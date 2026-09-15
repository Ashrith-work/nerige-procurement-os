/**
 * New-saree intake — the workflow and its separation of duties, against Postgres.
 *
 * What is being proved is mostly what CANNOT happen. The warehouse manager
 * submits and shoots; procurement decides; support and the developer read. Each
 * of those lines is drawn in migration 035 (`save_intake`, `transition_intake`
 * and the guard trigger), and each is only as good as a test that tries to cross
 * it the way a real client would: as `authenticated`, through the same function
 * or the same direct UPDATE PostgREST would send.
 *
 * Several tests need more than one person inside ONE transaction — the manager
 * sends a saree to review, then procurement approves it. The harness rolls each
 * `asUser` back, so a saree created by one call would not exist for the next;
 * `actAs` swaps the JWT subject mid-transaction instead, which is exactly what a
 * second PostgREST request would carry.
 *
 * The second half is unit tests for `src/lib/intake`, no database — including a
 * check that the TypeScript MRP and the SQL MRP agree.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { Client } from 'pg'
import { getTestDb, type TestDb } from './harness/db'
import { seedWorld, type World } from './harness/fixtures'
import { computeMrp, formatRupees } from '../src/lib/intake/pricing'
import { composeSku, previewSku, deriveCode, isValidCode } from '../src/lib/intake/sku'
import {
  availableTransitions,
  canTransition,
  canEditDraft,
  enoughImagesForReview,
  TRANSITIONS,
} from '../src/lib/intake/transitions'
import { INTAKE_STATUSES, STAGE_STATUSES, stageOf } from '../src/lib/intake/status'
import { parseStatusHistory } from '../src/lib/intake/history'

/**
 * A write is refused either by an error (a guard, a missing grant, RLS on
 * insert) or by RLS filtering every row out of reach (zero rows affected). The
 * savepoint keeps an error from poisoning the rest of the test's transaction.
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

/** Runs `sql`, expecting it to raise; returns the message. */
const raises = async (c: Client, sql: string, params: unknown[] = []): Promise<string> => {
  await c.query('savepoint e')
  try {
    await c.query(sql, params)
  } catch (err) {
    await c.query('rollback to savepoint e')
    return (err as Error).message
  }
  await c.query('release savepoint e')
  throw new Error(`Expected to raise: ${sql}`)
}

/** Becomes another signed-in person inside the current transaction. */
const actAs = (c: Client, userId: string) =>
  c.query("select set_config('request.jwt.claim.sub', $1, true)", [userId])

interface Saved {
  unique_code: number
  sku: string | null
  status: string
  outcome: string
}

const SAVE = `select public.save_intake($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) as r`

const save = async (
  c: Client,
  opts: {
    key: string
    vendorId: string
    collection?: string
    fabric?: string
    colour?: string
    productType?: string
    cost?: number
    draft?: boolean
    note?: string | null
  },
): Promise<Saved> => {
  const { rows } = await c.query<{ r: Saved }>(SAVE, [
    opts.key,
    opts.vendorId,
    opts.collection ?? 'VINT',
    opts.fabric ?? 'SLK',
    opts.colour ?? 'RED',
    opts.productType ?? 'SAREES',
    null,
    null,
    null,
    opts.cost ?? 1200,
    opts.draft ?? false,
    opts.note ?? null,
  ])
  return { ...rows[0].r, unique_code: Number(rows[0].r.unique_code) }
}

const move = (c: Client, code: number, to: string, extra: { from?: string; count?: number; reason?: string } = {}) =>
  c.query<{ r: { status: string; outcome: string } }>(
    `select public.transition_intake($1, $2::intake_status, $3::intake_status, $4, $5) as r`,
    [code, to, extra.from ?? null, extra.count ?? null, extra.reason ?? null],
  )

const intake = async (c: Client, code: number) => {
  const { rows } = await c.query(`select * from product_intakes where unique_code = $1`, [code])
  return rows[0]
}

let db: TestDb
let w: World
let admin: string
let manager: string
let manager2: string
let support: string
let developer: string

describe('intake workflow (database)', () => {
  beforeAll(async () => {
    db = await getTestDb()
    w = await db.asAdmin((c) => seedWorld(c))

    const makeStaff = async (role: string, email: string) =>
      db.asAdmin(async (c) => {
        const { rows } = await c.query<{ id: string }>(`insert into auth.users (email) values ($1) returning id`, [email])
        await c.query(
          `insert into app_users (id, role, status, full_name, email) values ($1, $2::app_role, 'active', $3, $4)`,
          [rows[0].id, role, email.split('@')[0], email],
        )
        return rows[0].id
      })

    admin = await makeStaff('admin', 'owner@nerige.test')
    manager = await makeStaff('warehouse_manager', 'wm@nerige.test')
    manager2 = await makeStaff('warehouse_manager', 'wm2@nerige.test')
    support = await makeStaff('customer_support', 'cs@nerige.test')
    developer = await makeStaff('developer', 'dev@nerige.test')

    // A code the sync discovered and nobody has named: exists, but is not
    // offered at intake.
    await db.asAdmin((c) => c.query(`insert into master_data (type, code) values ('collection', 'NEWC')`))
  }, 180_000)

  afterAll(async () => {
    await db?.stop()
  })

  it('manager submits: SKU_CREATED, SKU from the codes, and a continuous Unique Code', async () => {
    await db.asUser(manager, async (c) => {
      const first = await save(c, { key: 'k-submit-1', vendorId: w.vendorA.id })
      const second = await save(c, { key: 'k-submit-2', vendorId: w.vendorB.id, cost: 1234 })

      expect(first.outcome).toBe('created')
      expect(first.status).toBe('SKU_CREATED')
      expect(first.unique_code).toBeGreaterThanOrEqual(16001)
      expect(first.sku).toBe(`AAA-VINT-SLK-RED-${first.unique_code}`)
      expect(second.unique_code).toBe(first.unique_code + 1)
      expect(second.sku).toBe(`BBB-VINT-SLK-RED-${second.unique_code}`)

      const row = await intake(c, first.unique_code)
      expect(row.submitted_by).toBe(manager)
      expect(Number(row.mrp)).toBe(1920) // 1200 × 1.6, rounded up to 10
      expect(Number((await intake(c, second.unique_code)).mrp)).toBe(1980) // 1974.4 → 1980
      expect(row.status_history).toHaveLength(1)
      expect(row.status_history[0]).toMatchObject({ status: 'SKU_CREATED', by: manager })
    })
  })

  it('a repeated submission key creates one row and burns no code', async () => {
    await db.asUser(manager, async (c) => {
      const a = await save(c, { key: 'k-double', vendorId: w.vendorA.id })
      const b = await save(c, { key: 'k-double', vendorId: w.vendorA.id, cost: 9999 })
      expect(b.outcome).toBe('repeat')
      expect(b.unique_code).toBe(a.unique_code)
      expect(b.sku).toBe(a.sku)

      const { rows } = await c.query(`select count(*)::int as n from product_intakes where intake_key = 'k-double'`)
      expect(rows[0].n).toBe(1)
      // The repeat changed nothing, including the price it was sent with.
      expect(Number((await intake(c, a.unique_code)).cost_price)).toBe(1200)

      const next = await save(c, { key: 'k-double-next', vendorId: w.vendorA.id })
      expect(next.unique_code).toBe(a.unique_code + 1)
    })
  })

  it('manager shoots and sends to review, but cannot approve — by function, update or insert', async () => {
    await db.asUser(manager, async (c) => {
      const s = await save(c, { key: 'k-sod', vendorId: w.vendorA.id })

      expect(await raises(c, `select public.transition_intake($1, 'READY_FOR_REVIEW')`, [s.unique_code])).toMatch(
        /cannot be moved/,
      )
      await move(c, s.unique_code, 'SHOOT_PENDING')
      expect(await raises(c, `select public.transition_intake($1, 'READY_FOR_REVIEW', null, 0)`, [s.unique_code])).toMatch(
        /photograph/,
      )
      await move(c, s.unique_code, 'READY_FOR_REVIEW', { count: 4 })

      const row = await intake(c, s.unique_code)
      expect(row.status).toBe('READY_FOR_REVIEW')
      expect(row.img_status).toBe('READY_FOR_REVIEW')
      expect(row.image_count).toBe(4)

      expect(await raises(c, `select public.transition_intake($1, 'APPROVED')`, [s.unique_code])).toMatch(
        /procurement or the owner/,
      )

      // The hole migration 035 closes: her own SHOOT_PENDING saree, approved by
      // a plain UPDATE that 022's policy alone would have let through.
      const own = await save(c, { key: 'k-sod-direct', vendorId: w.vendorA.id })
      await move(c, own.unique_code, 'SHOOT_PENDING')
      expect(
        await refused(c, `update product_intakes set status = 'APPROVED', approval_status = 'APPROVED' where unique_code = $1`, [
          own.unique_code,
        ]),
      ).toBe(true)
      expect(
        await refused(
          c,
          `insert into product_intakes (intake_key, status, approval_status, vendor_id, collection_code, fabric_code,
             colour_code, product_type_code, cost_price)
           values ('k-born-approved', 'APPROVED', 'APPROVED', $1, 'VINT', 'SLK', 'RED', 'SAREES', 100)`,
          [w.vendorA.id],
        ),
      ).toBe(true)
      expect((await intake(c, own.unique_code)).status).toBe('SHOOT_PENDING')
    })
  })

  it('procurement approves, and cannot shoot', async () => {
    await db.asUser(manager, async (c) => {
      const s = await save(c, { key: 'k-approve', vendorId: w.vendorA.id })
      const other = await save(c, { key: 'k-approve-other', vendorId: w.vendorA.id })
      await move(c, s.unique_code, 'SHOOT_PENDING')
      await move(c, s.unique_code, 'READY_FOR_REVIEW', { count: 2 })

      await actAs(c, w.pooja)
      expect(await raises(c, `select public.transition_intake($1, 'SHOOT_PENDING')`, [other.unique_code])).toMatch(
        /warehouse manager or the owner/,
      )
      const { rows } = await move(c, s.unique_code, 'APPROVED', { from: 'READY_FOR_REVIEW' })
      expect(rows[0].r.status).toBe('APPROVED')

      // A second tap on a stale screen is quiet, not an error.
      const again = await move(c, s.unique_code, 'APPROVED', { from: 'READY_FOR_REVIEW' })
      expect(again.rows[0].r.outcome).toBe('already')

      const row = await intake(c, s.unique_code)
      expect(row.approval_status).toBe('APPROVED')
      expect(row.approved_by).toBe(w.pooja)
      expect(row.approved_at).not.toBeNull()
      expect(row.status_history.map((h: { status: string }) => h.status)).toEqual([
        'SKU_CREATED',
        'SHOOT_PENDING',
        'READY_FOR_REVIEW',
        'APPROVED',
      ])
    })
  })

  it('rejection needs a reason, keeps it, and the manager can reshoot', async () => {
    await db.asUser(manager, async (c) => {
      const s = await save(c, { key: 'k-reject', vendorId: w.vendorA.id })
      await move(c, s.unique_code, 'SHOOT_PENDING')
      await move(c, s.unique_code, 'READY_FOR_REVIEW', { count: 3 })

      await actAs(c, w.pooja)
      expect(await raises(c, `select public.transition_intake($1, 'REJECTED', null, null, '   ')`, [s.unique_code])).toMatch(
        /Say why/,
      )
      await move(c, s.unique_code, 'REJECTED', { reason: 'Pallu out of focus' })
      let row = await intake(c, s.unique_code)
      expect(row.status).toBe('REJECTED')
      expect(row.approval_status).toBe('REJECTED')
      expect(row.rejection_reason).toBe('Pallu out of focus')
      expect(row.status_history.at(-1)).toMatchObject({ status: 'REJECTED', note: 'Pallu out of focus', by: w.pooja })

      await actAs(c, manager)
      await move(c, s.unique_code, 'READY_FOR_SHOOT')
      row = await intake(c, s.unique_code)
      expect(row.status).toBe('READY_FOR_SHOOT')
      expect(row.approval_status).toBe('PENDING')
      expect(row.image_count).toBe(0)
    })

    // And the constraint from 022 still stands underneath, whoever writes.
    await db.asAdmin(async (c) => {
      await c.query('begin')
      try {
        expect(
          await raises(c, `update product_intakes set approval_status = 'REJECTED' where intake_key = 'TEST-INTAKE-AAA'`),
        ).toMatch(/rejection_needs_reason/)
      } finally {
        await c.query('rollback')
      }
    })
  })

  it('customer support and the developer cannot write', async () => {
    // Read privileged: since migration 037 customer support cannot read intake
    // rows at all, which is the point, so the code is found before switching.
    const code = await db.asAdmin(async (c) => {
      const { rows } = await c.query(`select unique_code from product_intakes where intake_key = 'TEST-INTAKE-AAA'`)
      return rows[0].unique_code as string
    })
    for (const who of [support, developer]) {
      await db.asUser(who, async (c) => {
        expect(await raises(c, SAVE, ['k-nope', w.vendorA.id, 'VINT', 'SLK', 'RED', 'SAREES', null, null, null, 100, false, null])).toMatch(
          /warehouse manager or the owner/,
        )
        expect(await raises(c, `select public.transition_intake($1, 'SHOOT_PENDING')`, [code])).toMatch(/cannot move/)
        expect(await refused(c, `update product_intakes set cost_price = 1 where unique_code = $1`, [code])).toBe(true)
        expect(
          await refused(
            c,
            `insert into product_intakes (intake_key, vendor_id, collection_code, fabric_code, colour_code, product_type_code, cost_price)
             values ('k-direct', $1, 'VINT', 'SLK', 'RED', 'SAREES', 100)`,
            [w.vendorA.id],
          ),
        ).toBe(true)
        expect(await refused(c, `update master_data set value = 'x' where code = 'NEWC'`)).toBe(true)
      })
    }
  })

  it('refuses a value that is not named, unless saved as a DRAFT — and promotes the draft later', async () => {
    await db.asUser(manager, async (c) => {
      const before = await save(c, { key: 'k-vocab-before', vendorId: w.vendorA.id })

      expect(await raises(c, SAVE, ['k-vocab', w.vendorA.id, 'NEWC', 'SLK', 'RED', 'SAREES', null, null, null, 800, false, null])).toMatch(
        /collection NEWC/,
      )
      // Refused before a code was allocated.
      const after = await save(c, { key: 'k-vocab-after', vendorId: w.vendorA.id })
      expect(after.unique_code).toBe(before.unique_code + 1)

      // A direct insert is refused by 022's trigger, the guarantee underneath.
      expect(
        await raises(
          c,
          `insert into product_intakes (intake_key, vendor_id, collection_code, fabric_code, colour_code, product_type_code, cost_price)
           values ('k-vocab-direct', $1, 'NEWC', 'SLK', 'RED', 'SAREES', 100)`,
          [w.vendorA.id],
        ),
      ).toMatch(/not an active, named value/)

      // A draft must say what it is waiting for.
      expect(await raises(c, SAVE, ['k-draft', w.vendorA.id, 'NEWC', 'SLK', '', 'SAREES', null, null, null, 800, true, ''])).toMatch(
        /Say what is missing/,
      )
      const draft = await save(c, {
        key: 'k-draft',
        vendorId: w.vendorA.id,
        collection: 'NEWC',
        colour: '',
        draft: true,
        note: 'Collection "New Classic" and colour teal are not in the list',
      })
      expect(draft.outcome).toBe('draft_saved')
      expect(draft.status).toBe('DRAFT')
      expect(draft.sku).toBeNull()
      const held = await intake(c, draft.unique_code)
      expect(held.collection_code).toBe('NEWC')
      expect(held.colour_code).toBe('?')

      // Another manager cannot finish somebody else's draft.
      await actAs(c, manager2)
      expect(await raises(c, SAVE, ['k-draft', w.vendorA.id, 'VINT', 'SLK', 'RED', 'SAREES', null, null, null, 800, false, null])).toMatch(
        /belongs to someone else/,
      )

      // The owner names the code; the draft is promoted and keeps its number.
      await actAs(c, admin)
      await c.query(`update master_data set value = 'New Classic', status = 'named' where type = 'collection' and code = 'NEWC'`)
      await actAs(c, manager)
      const promoted = await save(c, { key: 'k-draft', vendorId: w.vendorA.id, collection: 'NEWC', cost: 800 })
      expect(promoted.outcome).toBe('promoted')
      expect(promoted.unique_code).toBe(draft.unique_code)
      expect(promoted.sku).toBe(`AAA-NEWC-SLK-RED-${draft.unique_code}`)
      expect((await intake(c, draft.unique_code)).draft_note).toBe(held.draft_note)
    })
  })

  it('a manager corrects the price of her own saree, but not the codes on its fabric', async () => {
    await db.asUser(manager, async (c) => {
      const s = await save(c, { key: 'k-correct', vendorId: w.vendorA.id })
      await c.query(`update product_intakes set cost_price = 1500 where unique_code = $1`, [s.unique_code])
      expect(Number((await intake(c, s.unique_code)).mrp)).toBe(2400)

      expect(await raises(c, `update product_intakes set colour_code = 'RED', fabric_code = 'XX' where unique_code = $1`, [s.unique_code])).toMatch(
        /already on the fabric/,
      )
      expect(await raises(c, `update product_intakes set sku = 'BBB-X' where unique_code = $1`, [s.unique_code])).toMatch(
        /intake workflow/,
      )

      // A second manager shoots it — shooting is shared floor work.
      await actAs(c, manager2)
      await move(c, s.unique_code, 'SHOOT_PENDING')
      expect((await intake(c, s.unique_code)).status).toBe('SHOOT_PENDING')

      // The owner may still correct anything, as 022 promised.
      await actAs(c, admin)
      await c.query(`update product_intakes set fabric_code = 'SLK', status = 'READY_FOR_SHOOT' where unique_code = $1`, [
        s.unique_code,
      ])
      expect((await intake(c, s.unique_code)).status).toBe('READY_FOR_SHOOT')
    })
  })

  it('retiring a value stops new sarees using it, and does not freeze the ones mid-shoot', async () => {
    await db.asUser(manager, async (c) => {
      const s = await save(c, { key: 'k-retire', vendorId: w.vendorA.id })

      await actAs(c, admin)
      await c.query(`update master_data set active = false where type = 'fabric' and code = 'SLK'`)

      await actAs(c, manager)
      await move(c, s.unique_code, 'SHOOT_PENDING')
      await move(c, s.unique_code, 'READY_FOR_REVIEW', { count: 2 })
      expect((await intake(c, s.unique_code)).status).toBe('READY_FOR_REVIEW')

      expect(await raises(c, SAVE, ['k-retired-new', w.vendorA.id, 'VINT', 'SLK', 'RED', 'SAREES', null, null, null, 800, false, null])).toMatch(
        /fabric SLK/,
      )
    })
  })

  it('the history cannot be rewritten, even by the owner', async () => {
    await db.asUser(admin, async (c) => {
      const s = await save(c, { key: 'k-history', vendorId: w.vendorA.id })
      await c.query(`update product_intakes set status_history = '[]'::jsonb where unique_code = $1`, [s.unique_code])
      expect((await intake(c, s.unique_code)).status_history).toHaveLength(1)
    })
  })

  it('intake lookups are for staff and the developer, never a weaver', async () => {
    for (const who of [manager, support, developer]) {
      await db.asUser(who, async (c) => {
        const { rows } = await c.query(`select public.intake_form_context() as ctx`)
        expect(rows[0].ctx.vendors.map((v: { code: string }) => v.code)).toEqual(expect.arrayContaining(['AAA', 'BBB']))
        expect(Number(rows[0].ctx.mrp_markup_multiplier)).toBe(1.6)
        const people = await c.query(`select * from public.intake_people($1)`, [[manager]])
        expect(people.rows[0].full_name).toBe('wm')
      })
    }
    await db.asUser(w.vendorA.ownerUser, async (c) => {
      expect(await raises(c, `select public.intake_form_context()`)).toMatch(/staff/)
      expect(await raises(c, `select * from public.intake_people($1)`, [[manager]])).toMatch(/staff/)
    })
    await db.asAnon(async (c) => {
      expect(await raises(c, `select public.intake_form_context()`)).toMatch(/permission denied/)
    })
  })

  it('the SQL MRP and the TypeScript MRP agree', async () => {
    const cases: [string, string, number][] = [
      ['1200.00', '1.600', 10],
      ['1234.00', '1.600', 10],
      ['999.99', '1.600', 1],
      ['1.00', '1.555', 1],
      ['0.05', '1.500', 1],
      ['4575.50', '1.750', 50],
      ['333.33', '2.000', 100],
    ]
    await db.asAdmin(async (c) => {
      for (const [cost, mult, step] of cases) {
        const { rows } = await c.query<{ m: string }>(`select app.compute_mrp($1::numeric, $2::numeric, $3) as m`, [cost, mult, step])
        expect(computeMrp(cost, mult, step)).toBe(Number(rows[0].m))
      }
    })
  })
})

describe('src/lib/intake (unit)', () => {
  it('computeMrp rounds up to the step without the floating-point trap', () => {
    expect(computeMrp(1200, 1.6, 10)).toBe(1920) // 1200 * 1.6 is 1920.0000000000002 in floats
    expect(computeMrp('1234', '1.6', 10)).toBe(1980)
    expect(computeMrp(1000, 1.6, 10)).toBe(1600)
    expect(computeMrp('999.99', 1.6, 1)).toBe(1599.98)
    expect(computeMrp(0, 1.6, 10)).toBeNull()
    expect(computeMrp('abc', 1.6, 10)).toBeNull()
    expect(computeMrp(-5, 1.6, 10)).toBeNull()
    expect(computeMrp(null, 1.6, 10)).toBeNull()
  })

  it('formatRupees', () => {
    expect(formatRupees(1920)).toBe('₹1,920')
    expect(formatRupees(null)).toBe('—')
  })

  it('composes and previews the SKU', () => {
    expect(
      composeSku({ vendorCode: 'PGW', collectionCode: 'BRHM', fabricCode: 'SLK', colourCode: 'CRM', uniqueCode: 16001 }),
    ).toBe('PGW-BRHM-SLK-CRM-16001')
    expect(composeSku({ vendorCode: 'A', collectionCode: 'B', fabricCode: 'C', colourCode: 'D', uniqueCode: 1 }, '')).toBe(
      'A-B-C-D-1',
    )
    expect(previewSku({ vendorCode: 'PGW', collectionCode: '', fabricCode: 'SLK', colourCode: '?' })).toBe(
      'PGW-···-SLK-···-#####',
    )
  })

  it('derives and validates codes', () => {
    expect(deriveCode('Temple Border')).toBe('TMPL')
    // Too few consonants to fill four places: fall back to the letters as written.
    expect(deriveCode('Saree')).toBe('SARE')
    expect(deriveCode('Zari Butta')).toBe('ZRBT')
    expect(deriveCode('Aa')).toBe('AA')
    expect(isValidCode('BRHM')).toBe(true)
    expect(isValidCode('?')).toBe(false)
    expect(isValidCode('brhm')).toBe(false)
  })

  it('offers the manager the shoot and procurement the decision, never the other way', () => {
    expect(canTransition('warehouse_manager', 'READY_FOR_REVIEW', 'APPROVED')).toBe(false)
    expect(canTransition('procurement_head', 'READY_FOR_REVIEW', 'APPROVED')).toBe(true)
    expect(canTransition('procurement_head', 'SKU_CREATED', 'SHOOT_PENDING')).toBe(false)
    expect(canTransition('warehouse_manager', 'SKU_CREATED', 'SHOOT_PENDING')).toBe(true)
    expect(canTransition('admin', 'READY_FOR_REVIEW', 'REJECTED')).toBe(true)
    expect(canTransition('warehouse_manager', 'SKU_CREATED', 'READY_FOR_REVIEW')).toBe(false)
    for (const role of ['customer_support', 'developer', 'vendor'] as const) {
      for (const status of INTAKE_STATUSES) expect(availableTransitions(role, status)).toEqual([])
    }
    expect(TRANSITIONS.find((t) => t.to === 'REJECTED')?.requires).toBe('reason')
  })

  it('needs at least one photograph for review whatever the setting', () => {
    expect(enoughImagesForReview(0, 0)).toBe(false)
    expect(enoughImagesForReview(1, 0)).toBe(true)
    expect(enoughImagesForReview(2, 3)).toBe(false)
  })

  it('lets only the owner or the author edit a draft', () => {
    expect(canEditDraft('admin', 'u1', 'u2')).toBe(true)
    expect(canEditDraft('warehouse_manager', 'u1', 'u1')).toBe(true)
    expect(canEditDraft('warehouse_manager', 'u1', 'u2')).toBe(false)
    expect(canEditDraft('procurement_head', 'u1', 'u1')).toBe(false)
  })

  it('puts every status in exactly one stage', () => {
    for (const status of INTAKE_STATUSES) {
      const stages = Object.values(STAGE_STATUSES).filter((s) => s.includes(status))
      expect(stages, status).toHaveLength(1)
    }
    expect(stageOf('SHOOT_PENDING')).toBe('upload')
    expect(stageOf('PUBLISHED')).toBe('approved')
  })

  it('parses the status history defensively', () => {
    const parsed = parseStatusHistory([
      { status: 'READY_FOR_REVIEW', at: '2026-09-02T10:00:00Z', by: 'u1' },
      { status: 'SKU_CREATED', at: '2026-09-01T10:00:00Z' },
      { status: 'NONSENSE', at: '2026-09-01T10:00:00Z' },
      { status: 'APPROVED', at: 'not a date' },
      null,
      { status: 'REJECTED', at: '2026-09-03T10:00:00Z', note: '  ' },
    ])
    expect(parsed.map((p) => p.status)).toEqual(['SKU_CREATED', 'READY_FOR_REVIEW', 'REJECTED'])
    expect(parsed[2].note).toBeNull()
    expect(parseStatusHistory('nope')).toEqual([])
  })
})
