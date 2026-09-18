/**
 * The warehouse day sheet — who may keep it, what the database refuses, and the
 * arithmetic the manager reads off the bottom of each section.
 *
 * Two halves, for the same reason as the staff sheet next door. The database
 * half proves the record cannot be written by the wrong person and cannot hold
 * the same saree twice in a day, against a real Postgres, because that is where
 * both rules live. The pure half pins the reconciliation: a difference computed
 * one saree wrong sends somebody hunting the shelves for a saree that is on
 * them, or — far worse — says a day is settled when a saree is missing.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { Client } from 'pg'
import { getTestDb, type TestDb } from './harness/db'
import { seedWorld, type World } from './harness/fixtures'
import {
  COMMON_REASONS,
  MOVEMENTS,
  TOTAL_COLUMNS,
  canRecordDay,
  emptyTotals,
  formatSigned,
  movementFigures,
  movementIsSettled,
  movementLabel,
  needsAnswer,
  normaliseSku,
  splitMovements,
  splitPastedSkus,
  type MovementRow,
} from '../src/lib/day-sheet/calc'

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

let db: TestDb
let w: World
let admin: string
let manager: string
let support: string
let developer: string
let today: string

const makeStaffUser = async (c: Client, role: string, name: string): Promise<string> => {
  const email = `${name.toLowerCase()}@day.nerige.test`
  const { rows } = await c.query<{ id: string }>(`insert into auth.users (email) values ($1) returning id`, [email])
  await c.query(
    `insert into app_users (id, role, status, full_name, email) values ($1, $2::app_role, 'active', $3, $4)`,
    [rows[0].id, role, name, email],
  )
  return rows[0].id
}

beforeAll(async () => {
  db = await getTestDb()
  w = await db.asAdmin((c) => seedWorld(c))
  await db.asAdmin(async (c) => {
    admin = await makeStaffUser(c, 'admin', 'DayFounder')
    manager = await makeStaffUser(c, 'warehouse_manager', 'DayManager')
    support = await makeStaffUser(c, 'customer_support', 'DaySupport')
    developer = await makeStaffUser(c, 'developer', 'DayDeveloper')

    const { rows } = await c.query<{ d: string }>(`select app.staff_today()::text as d`)
    today = rows[0].d
  })
}, 180_000)

afterAll(async () => {
  await db?.stop()
})

const count = async (c: Client, sql: string, params: unknown[] = []): Promise<number> => {
  const { rows } = await c.query<{ n: string }>(sql, params)
  return Number(rows[0].n)
}

/** Refused by a missing grant (error) or by RLS filtering every row (0 rows). */
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

describe('day sheet — recording', () => {
  it('the manager writes the counts and the sarees, stamped with her id', async () => {
    await db.asUser(manager, async (c) => {
      await c.query(
        `insert into warehouse_days (work_date, cec_out, cec_back, video_orders, note, recorded_by)
         values ($1, 12, 9, 2, 'Two came back after the shutters', $2)`,
        [today, manager],
      )
      await c.query(
        `insert into warehouse_movements (work_date, kind, sku, recorded_by)
         values ($1, 'cec', 'PGW-VINT-SLK-RED-1011', $2),
                ($1, 'cec', 'PGW-VINT-SLK-RED-2011', $2),
                ($1, 'ai_colour', 'PGW-VINT-SLK-RED-1011', $2)`,
        [today, manager],
      )

      expect(await count(c, `select cec_out as n from warehouse_days where work_date = $1`, [today])).toBe(12)
      expect(await count(c, `select count(*) as n from warehouse_movements where work_date = $1`, [today])).toBe(3)
      expect(
        await count(c, `select count(*) as n from warehouse_movements where work_date = $1 and recorded_by = $2`, [
          today,
          manager,
        ]),
      ).toBe(3)
      // The defaults are the notebook's: written down means it went out, and
      // nothing has come back until somebody says so.
      const { rows } = await c.query(
        `select went_out, came_back, sold_offline from warehouse_movements where kind = 'ai_colour'`,
      )
      expect(rows[0]).toEqual({ went_out: true, came_back: false, sold_offline: false })
    })
  })

  it('ticks a saree back in and writes a reason against one that did not come back', async () => {
    await db.asUser(manager, async (c) => {
      await c.query(`insert into warehouse_days (work_date, cec_out, cec_back) values ($1, 4, 2)`, [today])
      await c.query(
        `insert into warehouse_movements (work_date, kind, sku) values ($1, 'cec', 'A'), ($1, 'cec', 'B')`,
        [today],
      )

      await c.query(`update warehouse_movements set came_back = true where work_date = $1 and sku = 'A'`, [today])
      const r = await c.query(
        `update warehouse_movements set reason = 'Missing', who = 'Lakshmi' where work_date = $1 and sku = 'B'`,
        [today],
      )
      expect(r.rowCount).toBe(1)

      expect(
        await count(c, `select count(*) as n from warehouse_movements where work_date = $1 and came_back`, [today]),
      ).toBe(1)
      const { rows } = await c.query(`select reason, who from warehouse_movements where sku = 'B'`)
      expect(rows[0]).toEqual({ reason: 'Missing', who: 'Lakshmi' })
    })
  })

  it('takes a mistyped line off the day', async () => {
    await db.asUser(manager, async (c) => {
      await c.query(`insert into warehouse_movements (work_date, kind, sku) values ($1, 'cec', 'TYPO')`, [today])
      const r = await c.query(`delete from warehouse_movements where work_date = $1 and sku = 'TYPO'`, [today])
      expect(r.rowCount).toBe(1)
    })
  })

  it('the owner may correct a day from a month ago; there is no window on this sheet', async () => {
    await db.asUser(admin, async (c) => {
      const r = await c.query(
        `insert into warehouse_days (work_date, cec_out, cec_back, recorded_by) values ($1::date - 30, 6, 6, $2)`,
        [today, admin],
      )
      expect(r.rowCount).toBe(1)
    })
    await db.asUser(manager, async (c) => {
      const r = await c.query(
        `insert into warehouse_movements (work_date, kind, sku) values ($1::date - 30, 'video_call', 'OLD')`,
        [today],
      )
      expect(r.rowCount).toBe(1)
    })
  })

  it('keeps one line per saree per movement per day, and no more', async () => {
    await db.asUser(manager, async (c) => {
      await c.query(`insert into warehouse_movements (work_date, kind, sku) values ($1, 'cec', 'DUP')`, [today])

      // The same saree, the same day, the same movement: a duplicate line, not
      // a second journey. Inside a savepoint, because the refusal aborts the
      // transaction the rest of this test still needs.
      await c.query('savepoint dup')
      await expect(
        c.query(`insert into warehouse_movements (work_date, kind, sku) values ($1, 'cec', 'DUP')`, [today]),
      ).rejects.toThrow(/duplicate key|unique/i)
      await c.query('rollback to savepoint dup')

      // The same saree under a different movement, and on another day, are both
      // genuinely different journeys and are allowed.
      await c.query(
        `insert into warehouse_movements (work_date, kind, sku)
         values ($1, 'ai_colour', 'DUP'), ($1::date - 1, 'cec', 'DUP')`,
        [today],
      )
      expect(await count(c, `select count(*) as n from warehouse_movements where sku = 'DUP'`)).toBe(3)
    })
  })

  it('refuses a negative count in any box', async () => {
    await db.asUser(manager, async (c) => {
      expect(await refused(c, `insert into warehouse_days (work_date, cec_out) values ($1, -1)`, [today])).toBe(true)
      expect(await refused(c, `insert into warehouse_days (work_date, video_orders) values ($1, -2)`, [today])).toBe(
        true,
      )
    })
  })

  it('refuses a line with no code on it', async () => {
    await db.asUser(manager, async (c) => {
      expect(
        await refused(c, `insert into warehouse_movements (work_date, kind, sku) values ($1, 'cec', '   ')`, [today]),
      ).toBe(true)
    })
  })

  it('stores a code the catalogue has never heard of', async () => {
    // The point of the column not being a foreign key: the CEC handles sarees
    // that are not in the catalogue yet, and a refused row is a row nobody
    // writes down at all.
    await db.asUser(manager, async (c) => {
      const r = await c.query(
        `insert into warehouse_movements (work_date, kind, sku) values ($1, 'cec', 'NOT-A-REAL-SKU-0001')`,
        [today],
      )
      expect(r.rowCount).toBe(1)
    })
  })
})

describe('day sheet — who may write it', () => {
  it('procurement reads the day but changes nothing on it', async () => {
    await db.asAdmin(async (c) => {
      await c.query(`insert into warehouse_days (work_date, cec_out, cec_back) values ($1::date - 3, 8, 5)`, [today])
      await c.query(`insert into warehouse_movements (work_date, kind, sku) values ($1::date - 3, 'cec', 'READ-ME')`, [
        today,
      ])
    })

    await db.asUser(w.pooja, async (c) => {
      // "Did that saree come back?" is asked on the phone, so reading is wide.
      expect(await count(c, `select count(*) as n from warehouse_days where work_date = $1::date - 3`, [today])).toBe(1)
      expect(await count(c, `select count(*) as n from warehouse_movements where sku = 'READ-ME'`)).toBe(1)

      expect(
        await refused(c, `insert into warehouse_days (work_date, cec_out) values ($1::date - 4, 1)`, [today]),
      ).toBe(true)
      expect(await refused(c, `update warehouse_days set cec_out = 99 where work_date = $1::date - 3`, [today])).toBe(
        true,
      )
      expect(
        await refused(c, `insert into warehouse_movements (work_date, kind, sku) values ($1, 'cec', 'NOPE')`, [today]),
      ).toBe(true)
      expect(await refused(c, `update warehouse_movements set came_back = true where sku = 'READ-ME'`)).toBe(true)
      expect(await refused(c, `delete from warehouse_movements where sku = 'READ-ME'`)).toBe(true)
    })
  })

  it('support reads it and changes nothing either', async () => {
    await db.asUser(support, async (c) => {
      expect(await count(c, `select count(*) as n from warehouse_movements where sku = 'READ-ME'`)).toBe(1)
      expect(await refused(c, `update warehouse_movements set reason = 'x' where sku = 'READ-ME'`)).toBe(true)
    })
  })

  it('a weaver sees nothing at all', async () => {
    await db.asUser(w.vendorA.ownerUser, async (c) => {
      expect(await count(c, `select count(*) as n from warehouse_days`)).toBe(0)
      expect(await count(c, `select count(*) as n from warehouse_movements`)).toBe(0)
      expect(await refused(c, `insert into warehouse_days (work_date, cec_out) values ($1, 1)`, [today])).toBe(true)
      expect(
        await refused(c, `insert into warehouse_movements (work_date, kind, sku) values ($1, 'cec', 'X')`, [today]),
      ).toBe(true)
      // Even the counts-only orders function is staff-gated.
      await expect(c.query(`select * from public.warehouse_day_orders($1)`, [today])).rejects.toThrow(
        /for Nerige staff/,
      )
    })
  })

  it('the developer reads everything and writes nothing', async () => {
    await db.asUser(developer, async (c) => {
      expect(await count(c, `select count(*) as n from warehouse_movements where sku = 'READ-ME'`)).toBe(1)
      expect(
        await refused(c, `insert into warehouse_movements (work_date, kind, sku) values ($1, 'cec', 'DEV')`, [today]),
      ).toBe(true)
      expect(await refused(c, `update warehouse_days set cec_out = 1 where work_date = $1::date - 3`, [today])).toBe(
        true,
      )
    })
  })

  it('anonymous reaches none of it', async () => {
    await db.asAnon(async (c) => {
      expect(await refused(c, `select * from warehouse_days`)).toBe(true)
      expect(await refused(c, `select * from warehouse_movements`)).toBe(true)
    })
  })
})

describe('day sheet — the orders half', () => {
  it('says the board is not connected rather than answering zeros', async () => {
    // This database carries the application and not the dispatch board, which
    // is exactly the case the function is written for. `board_connected` false
    // is the answer the screen turns into a sentence; the zeros beside it are
    // padding and are never rendered.
    await db.asUser(manager, async (c) => {
      const { rows } = await c.query(`select * from public.warehouse_day_orders($1)`, [today])
      expect(rows).toHaveLength(1)
      expect(rows[0].board_connected).toBe(false)
      expect(rows[0].orders_received).toBe(0)
      expect(rows[0].oldest_open).toBeNull()
    })
  })

  it('answers every staff role, because it returns counts and nothing else', async () => {
    for (const who of [admin, manager, support, w.pooja]) {
      await db.asUser(who, async (c) => {
        const { rows } = await c.query(`select board_connected from public.warehouse_day_orders($1)`, [today])
        expect(rows[0].board_connected).toBe(false)
      })
    }
  })

  it('admits the developer, who must see what the manager sees', async () => {
    // `app.is_staff()` does not admit `developer` — migration 033 keeps that role
    // out of every capability and gives it a blanket SELECT instead. The orders
    // function names it explicitly (migration 039), because view-as is how this
    // screen gets checked and an orders half that errors for the developer is a
    // screen nobody can verify. It returns counts only, so there is nothing here
    // to withhold from a login that already reads every table.
    await db.asUser(developer, async (c) => {
      const { rows } = await c.query(`select * from public.warehouse_day_orders($1)`, [today])
      expect(rows).toHaveLength(1)
      expect(rows[0].board_connected).toBe(false)
    })
  })

  it('names the same columns the loader reads', async () => {
    // The loader maps snake_case to the screen's names by hand. A column
    // renamed in the migration without the loader following would read as
    // undefined and paint the day as empty, which is the one thing this screen
    // must never do silently.
    await db.asUser(manager, async (c) => {
      const { fields } = await c.query(`select * from public.warehouse_day_orders($1)`, [today])
      expect(fields.map((f) => f.name).sort()).toEqual(
        [
          'board_connected',
          'can_ship_today',
          'dispatched',
          'domestic',
          'international',
          'offline_orders',
          'oldest_open',
          'open_till_date',
          'orders_received',
          'saree_only',
          'service_orders',
          'still_to_go',
          'stitched_orders',
        ].sort(),
      )
    })
  })

  it('every movement names two columns that exist on warehouse_days', async () => {
    // TOTAL_COLUMNS is the only place the screen writes these names down.
    const expected = MOVEMENTS.flatMap((m) => [TOTAL_COLUMNS[m.kind].out, TOTAL_COLUMNS[m.kind].back])
    await db.asAdmin(async (c) => {
      const { rows } = await c.query<{ column_name: string }>(
        `select column_name from information_schema.columns
          where table_schema = 'public' and table_name = 'warehouse_days'`,
      )
      const present = new Set(rows.map((r) => r.column_name))
      for (const column of expected) expect(present.has(column), column).toBe(true)
    })
  })
})

// ---------------------------------------------------------------------------
// The arithmetic
// ---------------------------------------------------------------------------

let nextId = 0
const row = (sku: string, over: Partial<MovementRow> = {}): MovementRow => ({
  id: `row-${nextId++}`,
  kind: 'cec',
  sku,
  wentOut: true,
  cameBack: false,
  soldOffline: false,
  billNo: '',
  reason: '',
  who: '',
  known: true,
  ...over,
})

describe('the three lists', () => {
  // Six went out to the CEC, two are back. Of the four still out, two were sold
  // at the counter and one of the other two has an answer against it.
  const rows = [
    row('A', { cameBack: true }),
    row('B', { cameBack: true }),
    row('C', { soldOffline: true, billNo: '4471' }),
    row('D', { soldOffline: true, billNo: '4472' }),
    row('E', { reason: 'Missing', who: 'Lakshmi' }),
    row('F'),
  ]
  const split = splitMovements(rows)

  it('reads all three off the same lines', () => {
    expect(split.notBack.map((r) => r.sku)).toEqual(['C', 'D', 'E', 'F'])
    expect(split.soldOffline.map((r) => r.sku)).toEqual(['C', 'D'])
    expect(split.unexplained.map((r) => r.sku)).toEqual(['E', 'F'])
    expect(split.unanswered.map((r) => r.sku)).toEqual(['F'])
  })

  it('keeps the order the sarees were written down in', () => {
    // Not sorted, not grouped: the manager reads back down the list they typed.
    expect(split.notBack.map((r) => r.sku)).toEqual(['C', 'D', 'E', 'F'])
  })

  it('leaves a line that never went out out of every list', () => {
    const only = splitMovements([row('G', { wentOut: false })])
    expect(only.notBack).toEqual([])
    expect(only.unexplained).toEqual([])
  })

  it('wants a reason, not a name', () => {
    // A name with no reason explains nothing; a reason with no name is still an
    // account of where the saree went.
    expect(needsAnswer(row('X'))).toBe(true)
    expect(needsAnswer(row('X', { who: 'Ravi' }))).toBe(true)
    expect(needsAnswer(row('X', { reason: 'Missing' }))).toBe(false)
    expect(needsAnswer(row('X', { reason: '   ' }))).toBe(true)
    expect(needsAnswer(row('X', { cameBack: true }))).toBe(false)
    expect(needsAnswer(row('X', { soldOffline: true }))).toBe(false)
  })
})

describe('the difference', () => {
  const rows = [
    row('A', { cameBack: true }),
    row('B', { cameBack: true }),
    row('C', { soldOffline: true }),
    row('D', { soldOffline: true }),
    row('E', { reason: 'Missing' }),
    row('F'),
  ]
  const split = splitMovements(rows)

  it('takes the difference from the counted boxes, not from the lines', () => {
    const f = movementFigures(6, 2, split)
    expect(f.difference).toBe(4)
    expect(f.offlineSold).toBe(2)
    expect(f.stillToExplain).toBe(2)
    expect(f.unlisted).toBe(0)
    expect(movementIsSettled(f, split)).toBe(false)
  })

  it('says how many are still to be written down', () => {
    // Nine went out and two came back, so seven are out — but only four have
    // been written down. Three are still on the bench, uncounted.
    const f = movementFigures(9, 2, split)
    expect(f.difference).toBe(7)
    expect(f.unlisted).toBe(3)
    expect(f.stillToExplain).toBe(5)
  })

  it('goes negative when there are more lines than the counts allow', () => {
    const f = movementFigures(3, 2, split)
    expect(f.difference).toBe(1)
    expect(f.unlisted).toBe(-3)
    expect(f.stillToExplain).toBe(-1)
  })

  it('more back than out is a miscount, shown rather than clamped', () => {
    const f = movementFigures(2, 5, splitMovements([]))
    expect(f.difference).toBe(-3)
    expect(formatSigned(f.difference)).toBe('−3')
  })

  it('settles only when nothing is outstanding on any of the three counts', () => {
    const clean = [row('A', { cameBack: true }), row('B', { soldOffline: true })]
    const cleanSplit = splitMovements(clean)
    expect(movementIsSettled(movementFigures(2, 1, cleanSplit), cleanSplit)).toBe(true)

    // One sold and one with no answer: the counts add up, the sheet does not.
    const open = [row('A', { soldOffline: true }), row('B')]
    const openSplit = splitMovements(open)
    const f = movementFigures(2, 0, openSplit)
    expect(f.stillToExplain).toBe(1)
    expect(movementIsSettled(f, openSplit)).toBe(false)
  })

  it('a day with nothing on it is settled, not broken', () => {
    const empty = splitMovements([])
    expect(movementIsSettled(movementFigures(0, 0, empty), empty)).toBe(true)
  })
})

describe('codes as they are typed', () => {
  it('trims and collapses, and never changes the case', () => {
    expect(normaliseSku('  PGW-101  ')).toBe('PGW-101')
    // SKUs contain spaces here ("DMG - 157"), so they cannot simply be stripped.
    expect(normaliseSku('DMG  -   157')).toBe('DMG - 157')
    // Upper-casing would store something the person did not write, and flag a
    // perfectly good lower-case code as unknown.
    expect(normaliseSku('pgw-101')).toBe('pgw-101')
    expect(normaliseSku('   ')).toBe('')
  })

  it('splits a column pasted out of a spreadsheet', () => {
    expect(splitPastedSkus('A-1\nB-2\r\nC-3')).toEqual(['A-1', 'B-2', 'C-3'])
    expect(splitPastedSkus('A-1, B-2 ,,A-1')).toEqual(['A-1', 'B-2'])
    expect(splitPastedSkus('\n \n')).toEqual([])
    expect(splitPastedSkus('one code')).toEqual(['one code'])
  })
})

describe("the screen's own vocabulary", () => {
  it('names all three movements, once each', () => {
    expect(MOVEMENTS.map((m) => m.kind)).toEqual(['cec', 'ai_colour', 'video_call'])
    expect(new Set(MOVEMENTS.map((m) => m.label)).size).toBe(3)
    expect(movementLabel('ai_colour')).toBe('AI colour change')
  })

  it('starts a day at nothing, not at nothing-known', () => {
    const totals = emptyTotals()
    expect(totals.out).toEqual({ cec: 0, ai_colour: 0, video_call: 0 })
    expect(totals.videoOrders).toBe(0)
    expect(totals.note).toBe('')
  })

  it('offers the reasons already written on the page', () => {
    expect(COMMON_REASONS).toContain('Missing')
  })

  it('lets the manager and the owner write, and nobody else', () => {
    // The application-side twin of app.can_record_day(), proved above in SQL.
    expect(canRecordDay('warehouse_manager')).toBe(true)
    expect(canRecordDay('admin')).toBe(true)
    expect(canRecordDay('procurement_head')).toBe(false)
    expect(canRecordDay('customer_support')).toBe(false)
    expect(canRecordDay('developer')).toBe(false)
    expect(canRecordDay('vendor')).toBe(false)
  })
})
