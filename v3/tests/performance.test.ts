/**
 * The floor-staff sheet — who may write it, when, and the arithmetic on top.
 *
 * Two halves. The database half proves the register cannot be rewritten by the
 * wrong person or after the window closes, against a real Postgres, because
 * that is where the rule lives. The pure half pins the numbers the founders
 * read next to a person's name: a wrong target or a gap counted as a zero
 * throws no error, it just makes somebody look slow.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { Client } from 'pg'
import { getTestDb, type TestDb } from './harness/db'
import { seedWorld, type World } from './harness/fixtures'
import {
  addDays,
  daysBetween,
  eachDate,
  isIsoDate,
  isWithinEditWindow,
  resolvePeriod,
  startOfWeek,
  todayInWarehouse,
  formatDay,
} from '../src/lib/performance/period'
import {
  adjustedTarget,
  buildDayFill,
  buildPeriodSummary,
  completion,
  dayKey,
  formatPercent,
  isExpected,
  outputIndex,
  type DayRecord,
  type StaffMember,
  type StaffTask,
} from '../src/lib/performance/calc'

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

let db: TestDb
let w: World
let admin: string
let manager: string
let support: string
let developer: string
let lakshmi: string
let ravi: string
let today: string

const makeStaffUser = async (c: Client, role: string, name: string): Promise<string> => {
  const email = `${name.toLowerCase()}@perf.nerige.test`
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
    admin = await makeStaffUser(c, 'admin', 'Founder')
    manager = await makeStaffUser(c, 'warehouse_manager', 'Manager')
    support = await makeStaffUser(c, 'customer_support', 'Support')
    developer = await makeStaffUser(c, 'developer', 'Developer')

    const { rows: t } = await c.query<{ d: string }>(`select app.staff_today()::text as d`)
    today = t[0].d

    const { rows } = await c.query<{ id: string }>(
      `insert into floor_staff (display_name, started_on, created_by)
       values ('Lakshmi', $1::date - 60, $2), ('Ravi', $1::date - 60, $2)
       returning id`,
      [today, admin],
    )
    lakshmi = rows[0].id
    ravi = rows[1].id

    // A day already on the record, well outside the manager's window.
    await c.query(
      `insert into staff_days (staff_id, work_date, attendance, recorded_by)
       values ($1, $2::date - 30, 'present', $3)`,
      [lakshmi, today, manager],
    )
    await c.query(
      `insert into staff_day_counts (staff_id, work_date, task_code, quantity, recorded_by)
       values ($1, $2::date - 30, 'pick', 200, $3)`,
      [lakshmi, today, manager],
    )
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

const sheet = (entries: unknown[]) => JSON.stringify(entries)

describe('staff sheet — recording', () => {
  it('the manager records a whole sheet in one call, stamped with her id', async () => {
    await db.asUser(manager, async (c) => {
      const { rows } = await c.query<{ n: number }>(`select public.save_staff_sheet($1, $2::jsonb) as n`, [
        today,
        sheet([
          {
            staff_id: lakshmi,
            attendance: 'present',
            note: 'Fast day',
            counts: { pick: 240, pack: 30, fold: null },
            add_flags: [{ kind: 'damage', order_ref: '#10432', note: 'Torn pallu' }],
          },
          { staff_id: ravi, attendance: 'half_day', counts: { pack: 40 } },
        ]),
      ])
      expect(rows[0].n).toBe(2)

      expect(await count(c, `select count(*) as n from staff_days where work_date = $1`, [today])).toBe(2)
      expect(
        await count(c, `select count(*) as n from staff_days where work_date = $1 and recorded_by = $2`, [
          today,
          manager,
        ]),
      ).toBe(2)
      expect(
        await count(c, `select quantity as n from staff_day_counts where staff_id = $1 and work_date = $2 and task_code = 'pick'`, [
          lakshmi,
          today,
        ]),
      ).toBe(240)
      // A box left empty invents no row.
      expect(
        await count(c, `select count(*) as n from staff_day_counts where staff_id = $1 and work_date = $2 and task_code = 'fold'`, [
          lakshmi,
          today,
        ]),
      ).toBe(0)
      expect(await count(c, `select count(*) as n from staff_quality_flags where work_date = $1`, [today])).toBe(1)
    })
  })

  it('re-saving updates in place, zeroes a cleared count, and withdraws a flag', async () => {
    await db.asUser(manager, async (c) => {
      await c.query(`select public.save_staff_sheet($1, $2::jsonb)`, [
        today,
        sheet([{ staff_id: lakshmi, attendance: 'present', counts: { pick: 100 }, add_flags: [{ kind: 'repack' }] }]),
      ])
      const { rows: f } = await c.query<{ id: string }>(`select id from staff_quality_flags where staff_id = $1`, [lakshmi])

      await c.query(`select public.save_staff_sheet($1, $2::jsonb)`, [
        today,
        sheet([{ staff_id: lakshmi, attendance: 'half_day', counts: { pick: null }, remove_flag_ids: [f[0].id] }]),
      ])

      expect(await count(c, `select count(*) as n from staff_days where staff_id = $1`, [lakshmi])).toBe(2)
      const { rows: d } = await c.query(`select attendance from staff_days where staff_id = $1 and work_date = $2`, [lakshmi, today])
      expect(d[0].attendance).toBe('half_day')
      expect(
        await count(c, `select quantity as n from staff_day_counts where staff_id = $1 and work_date = $2 and task_code = 'pick'`, [
          lakshmi,
          today,
        ]),
      ).toBe(0)
      const { rows: removed } = await c.query(`select removed_at, removed_by from staff_quality_flags where id = $1`, [f[0].id])
      expect(removed[0].removed_at).not.toBeNull()
      expect(removed[0].removed_by).toBe(manager)
    })
  })

  it('skips a person with no attendance, but refuses work recorded without it', async () => {
    await db.asUser(manager, async (c) => {
      const { rows } = await c.query<{ n: number }>(`select public.save_staff_sheet($1, $2::jsonb) as n`, [
        today,
        sheet([{ staff_id: ravi, attendance: null, counts: { pick: null } }]),
      ])
      expect(rows[0].n).toBe(0)
    })
    await expect(
      db.asUser(manager, (c) =>
        c.query(`select public.save_staff_sheet($1, $2::jsonb)`, [
          today,
          sheet([{ staff_id: ravi, attendance: null, counts: { pick: 10 } }]),
        ]),
      ),
    ).rejects.toThrow(/Mark attendance for Ravi/)
  })

  it('refuses work counted against someone absent or on leave', async () => {
    await expect(
      db.asUser(manager, (c) =>
        c.query(`select public.save_staff_sheet($1, $2::jsonb)`, [
          today,
          sheet([{ staff_id: ravi, attendance: 'leave', counts: { pack: 5 } }]),
        ]),
      ),
    ).rejects.toThrow(/marked leave, but has work counted/)
  })

  it('never hard-deletes a day, even for the owner', async () => {
    await db.asUser(admin, async (c) => {
      expect(await refused(c, `delete from staff_days where staff_id = $1`, [lakshmi])).toBe(true)
      expect(await refused(c, `delete from floor_staff where id = $1`, [lakshmi])).toBe(true)
    })
    await expect(
      db.asAdmin((c) => c.query(`delete from staff_days where staff_id = $1`, [lakshmi])),
    ).rejects.toThrow(/Hard delete is not permitted/)
  })

  it('the manager keeps the roster: adds and deactivates, never deletes', async () => {
    await db.asUser(manager, async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `insert into floor_staff (display_name, created_by) values ('Meena', $1) returning id`,
        [manager],
      )
      const r = await c.query(
        `update floor_staff set active = false, deactivated_on = app.staff_today() where id = $1`,
        [rows[0].id],
      )
      expect(r.rowCount).toBe(1)
    })
  })
})

describe('staff sheet — the edit window', () => {
  it('lets the manager change a day 7 days ago', async () => {
    await db.asUser(manager, async (c) => {
      const r = await c.query(
        `insert into staff_days (staff_id, work_date, attendance, recorded_by) values ($1, $2::date - 7, 'absent', $3)`,
        [ravi, today, manager],
      )
      expect(r.rowCount).toBe(1)
    })
  })

  it('refuses the manager a day 8 days ago, directly and through the function', async () => {
    await db.asUser(manager, async (c) => {
      expect(
        await refused(
          c,
          `insert into staff_days (staff_id, work_date, attendance, recorded_by) values ($1, $2::date - 8, 'present', $3)`,
          [ravi, today, manager],
        ),
      ).toBe(true)
      // The old day seeded 30 days back: visible, not changeable.
      expect(await count(c, `select count(*) as n from staff_days where work_date = $1::date - 30`, [today])).toBe(1)
      expect(
        await refused(c, `update staff_days set attendance = 'absent' where work_date = $1::date - 30`, [today]),
      ).toBe(true)
      expect(
        await refused(c, `update staff_day_counts set quantity = 999 where work_date = $1::date - 30`, [today]),
      ).toBe(true)
    })
    await expect(
      db.asUser(manager, (c) =>
        c.query(`select public.save_staff_sheet($1::date - 30, $2::jsonb)`, [
          today,
          sheet([{ staff_id: lakshmi, attendance: 'absent' }]),
        ]),
      ),
    ).rejects.toThrow(/cannot be changed from this account/)
  })

  it('refuses the manager moving an open day onto a closed date', async () => {
    await db.asUser(manager, async (c) => {
      await c.query(
        `insert into staff_days (staff_id, work_date, attendance, recorded_by) values ($1, $2::date - 1, 'present', $3)`,
        [ravi, today, manager],
      )
      expect(
        await refused(c, `update staff_days set work_date = $1::date - 40 where staff_id = $2 and work_date = $1::date - 1`, [
          today,
          ravi,
        ]),
      ).toBe(true)
    })
  })

  it('refuses everyone, the owner included, a day in the future', async () => {
    for (const who of [manager, admin]) {
      await db.asUser(who, async (c) => {
        expect(
          await refused(
            c,
            `insert into staff_days (staff_id, work_date, attendance, recorded_by) values ($1, $2::date + 1, 'present', $3)`,
            [ravi, today, who],
          ),
        ).toBe(true)
      })
    }
  })

  it('lets the owner correct a day from a month ago', async () => {
    await db.asUser(admin, async (c) => {
      const r = await c.query(
        `update staff_days set attendance = 'half_day' where staff_id = $1 and work_date = $2::date - 30`,
        [lakshmi, today],
      )
      expect(r.rowCount).toBe(1)
      const { rows } = await c.query(`select recorded_by from staff_days where staff_id = $1 and work_date = $2::date - 30`, [
        lakshmi,
        today,
      ])
      // The correction is on the record as the owner's.
      expect(rows[0].recorded_by).toBe(admin)

      const n = await c.query(`select public.save_staff_sheet($1::date - 30, $2::jsonb) as n`, [
        today,
        sheet([{ staff_id: ravi, attendance: 'present', counts: { pick: 120 } }]),
      ])
      expect(n.rows[0].n).toBe(1)
    })
  })
})

describe('staff sheet — who is kept out', () => {
  for (const role of ['customer_support', 'procurement_head', 'vendor'] as const) {
    it(`${role} can neither read nor write any of it`, async () => {
      const user = role === 'customer_support' ? support : role === 'procurement_head' ? w.pooja : w.vendorA.ownerUser
      await db.asUser(user, async (c) => {
        for (const t of ['floor_staff', 'staff_tasks', 'staff_days', 'staff_day_counts', 'staff_quality_flags']) {
          expect(await count(c, `select count(*) as n from ${t}`), t).toBe(0)
        }
        expect(
          await refused(
            c,
            `insert into staff_days (staff_id, work_date, attendance, recorded_by) values ($1, $2, 'present', $3)`,
            [ravi, today, user],
          ),
        ).toBe(true)
        expect(await refused(c, `insert into floor_staff (display_name) values ('Intruder')`)).toBe(true)
        expect(await refused(c, `update floor_staff set display_name = 'x'`)).toBe(true)
        expect(await refused(c, `update staff_tasks set target_per_day = 1`)).toBe(true)
        expect(
          await refused(c, `select public.save_staff_sheet($1, $2::jsonb)`, [
            today,
            sheet([{ staff_id: ravi, attendance: 'present' }]),
          ]),
        ).toBe(true)
      })
    })
  }

  it('the developer reads everything and writes nothing', async () => {
    await db.asUser(developer, async (c) => {
      expect(await count(c, `select count(*) as n from floor_staff`)).toBeGreaterThanOrEqual(2)
      expect(await count(c, `select count(*) as n from staff_tasks`)).toBe(8)
      expect(await count(c, `select count(*) as n from staff_days`)).toBeGreaterThanOrEqual(1)
      expect(await count(c, `select count(*) as n from staff_day_counts`)).toBeGreaterThanOrEqual(1)

      expect(
        await refused(
          c,
          `insert into staff_days (staff_id, work_date, attendance, recorded_by) values ($1, $2, 'present', $3)`,
          [ravi, today, developer],
        ),
      ).toBe(true)
      expect(await refused(c, `update staff_days set attendance = 'absent'`)).toBe(true)
      expect(await refused(c, `update floor_staff set active = false, deactivated_on = current_date`)).toBe(true)
      expect(await refused(c, `update staff_tasks set target_per_day = 1`)).toBe(true)
      expect(
        await refused(c, `select public.save_staff_sheet($1, $2::jsonb)`, [
          today,
          sheet([{ staff_id: ravi, attendance: 'present' }]),
        ]),
      ).toBe(true)
    })
  })

  it('only the owner sets targets; the manager reads them', async () => {
    await db.asUser(manager, async (c) => {
      expect(await count(c, `select target_per_day as n from staff_tasks where code = 'pick'`)).toBe(259)
      expect(await refused(c, `update staff_tasks set target_per_day = 100 where code = 'pick'`)).toBe(true)
      expect(await refused(c, `insert into staff_tasks (code, label) values ('iron', 'Iron')`)).toBe(true)
    })
    await db.asUser(admin, async (c) => {
      const r = await c.query(`update staff_tasks set target_per_day = 300 where code = 'pick'`)
      expect(r.rowCount).toBe(1)
    })
  })
})

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe('period arithmetic', () => {
  it("uses the warehouse's date, not UTC's", () => {
    // 20:00 UTC on the 14th is 01:30 on the 15th in Bengaluru.
    expect(todayInWarehouse(new Date('2026-09-14T20:00:00Z'))).toBe('2026-09-15')
    expect(todayInWarehouse(new Date('2026-09-14T18:00:00Z'))).toBe('2026-09-14')
  })

  it('validates, adds and spans ISO dates', () => {
    expect(isIsoDate('2026-02-28')).toBe(true)
    expect(isIsoDate('2026-02-30')).toBe(false)
    expect(isIsoDate('15/09/2026')).toBe(false)
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(daysBetween('2026-09-08', '2026-09-15')).toBe(7)
    expect(eachDate('2026-09-13', '2026-09-15')).toEqual(['2026-09-13', '2026-09-14', '2026-09-15'])
    expect(eachDate('2026-09-15', '2026-09-13')).toEqual([])
    expect(formatDay('2026-09-15')).toBe('Tue 15 Sep')
  })

  it('matches the database edit window: today and the 7 days before', () => {
    expect(isWithinEditWindow('2026-09-15', '2026-09-15')).toBe(true)
    expect(isWithinEditWindow('2026-09-08', '2026-09-15')).toBe(true)
    expect(isWithinEditWindow('2026-09-07', '2026-09-15')).toBe(false)
    expect(isWithinEditWindow('2026-09-16', '2026-09-15')).toBe(false)
  })

  it('resolves presets, weeks starting Monday', () => {
    const t = '2026-09-17' // a Thursday
    expect(startOfWeek(t)).toBe('2026-09-14')
    expect(startOfWeek('2026-09-20')).toBe('2026-09-14') // Sunday belongs to the week before
    expect(resolvePeriod({}, t)).toEqual({ preset: 'this_week', from: '2026-09-14', to: t })
    expect(resolvePeriod({ preset: 'last_week' }, t)).toEqual({ preset: 'last_week', from: '2026-09-07', to: '2026-09-13' })
    expect(resolvePeriod({ preset: 'this_month' }, t)).toEqual({ preset: 'this_month', from: '2026-09-01', to: t })
    expect(resolvePeriod({ preset: 'last_month' }, t)).toEqual({ preset: 'last_month', from: '2026-08-01', to: '2026-08-31' })
  })

  it('tidies a custom range: swapped, capped at today, capped in length', () => {
    const t = '2026-09-17'
    expect(resolvePeriod({ preset: 'custom', from: '2026-09-10', to: '2026-09-01' }, t)).toEqual({
      preset: 'custom',
      from: '2026-09-01',
      to: '2026-09-10',
    })
    expect(resolvePeriod({ preset: 'custom', from: '2026-09-10', to: '2026-12-01' }, t).to).toBe(t)
    const long = resolvePeriod({ preset: 'custom', from: '2025-01-01', to: '2026-09-17' }, t)
    expect(daysBetween(long.from, long.to) + 1).toBe(93)
    expect(resolvePeriod({ preset: 'custom', from: 'nonsense', to: '2026-09-01' }, t).preset).toBe('this_week')
  })
})

describe('targets and completion', () => {
  it('scales a target by attendance days and refuses to invent one', () => {
    expect(adjustedTarget(259, 1)).toBe(259)
    expect(adjustedTarget(259, 4.5)).toBe(1165.5)
    expect(adjustedTarget(null, 5)).toBeNull()
    expect(adjustedTarget(259, 0)).toBe(0)
    expect(completion(130, adjustedTarget(259, 0.5))).toBeCloseTo(130 / 129.5)
    expect(completion(10, 0)).toBeNull()
    expect(completion(10, null)).toBeNull()
    expect(formatPercent(0.845)).toBe('85%')
    expect(formatPercent(null)).toBe('—')
  })

  it('credits mixed work in full-day targets', () => {
    const out = outputIndex({ pick: 130, pack: 50, tassels: 12 }, { pick: 260, pack: 100, tassels: null }, 1)
    expect(out.targetDays).toBeCloseTo(1)
    expect(out.ratio).toBeCloseTo(1)
    expect(out.untargetedUnits).toBe(12)
    // No attendance, no verdict.
    expect(outputIndex({ pick: 10 }, { pick: 260 }, 0).ratio).toBeNull()
    // Only untargeted work: no verdict either.
    expect(outputIndex({ tassels: 10 }, { tassels: null }, 1).ratio).toBeNull()
  })
})

describe('the period summary', () => {
  const staff: StaffMember[] = [
    { id: 'a', name: 'Lakshmi', startedOn: '2026-01-01', active: true, deactivatedOn: null },
    // Joined mid-week: days before are not gaps.
    { id: 'b', name: 'Ravi', startedOn: '2026-09-10', active: true, deactivatedOn: null },
    // Left before the period: not listed.
    { id: 'c', name: 'Old', startedOn: '2025-01-01', active: false, deactivatedOn: '2026-08-01' },
  ]
  const tasks: StaffTask[] = [
    { code: 'pick', label: 'Pick', targetPerDay: 259, sortOrder: 10, active: true },
    { code: 'pack', label: 'Pack', targetPerDay: null, sortOrder: 20, active: true },
  ]
  const rec = (staffId: string, date: string, attendance: DayRecord['attendance'], counts: Record<string, number> = {}): DayRecord => ({
    staffId,
    date,
    attendance,
    counts,
    note: null,
    recordedBy: 'm',
    recordedByName: null,
    updatedAt: '',
    flags: [],
  })

  // Mon 7 Sep – Sun 13 Sep 2026.
  const records: DayRecord[] = [
    rec('a', '2026-09-07', 'present', { pick: 259 }),
    rec('a', '2026-09-08', 'half_day', { pick: 100, pack: 20 }),
    rec('a', '2026-09-09', 'absent'),
    // 10th: nobody recorded — a gap for both.
    rec('a', '2026-09-11', 'present', { pick: 300 }),
    rec('b', '2026-09-11', 'leave'),
    { ...rec('a', '2026-09-12', 'present', { pick: 200 }), flags: [{ id: 'f', staffId: 'a', date: '2026-09-12', kind: 'damage', orderRef: null, note: null, createdAt: '' }] },
  ]

  const s = buildPeriodSummary({ from: '2026-09-07', to: '2026-09-13', staff, tasks, records })
  const lakshmi = s.people.find((p) => p.staff.id === 'a')!
  const ravi = s.people.find((p) => p.staff.id === 'b')!

  it('drops people with nothing expected and nothing recorded', () => {
    expect(s.people.map((p) => p.staff.name)).toEqual(['Lakshmi', 'Ravi'])
  })

  it('counts a half day as half, and gaps as gaps — never as absence', () => {
    expect(lakshmi.attendance).toEqual({ present: 3, half_day: 1, absent: 1, leave: 0 })
    expect(lakshmi.attendanceDays).toBe(3.5)
    expect(lakshmi.expectedDays).toBe(6) // Sunday is not expected
    expect(lakshmi.unrecordedDates).toEqual(['2026-09-10'])
    expect(lakshmi.cells['2026-09-10']).toEqual({ kind: 'missing' })
    expect(lakshmi.cells['2026-09-13']).toEqual({ kind: 'not_expected' })
  })

  it('measures totals against the attendance-adjusted target only', () => {
    const pick = lakshmi.tasks.find((t) => t.code === 'pick')!
    expect(pick.total).toBe(859)
    expect(pick.target).toBe(259 * 3.5)
    expect(pick.completion).toBeCloseTo(859 / (259 * 3.5))
    const pack = lakshmi.tasks.find((t) => t.code === 'pack')!
    expect(pack).toMatchObject({ total: 20, target: null, completion: null })
    expect(lakshmi.flags.total).toBe(1)
    expect(lakshmi.flags.byKind.damage).toBe(1)
  })

  it("does not blame a new joiner for days before they started", () => {
    expect(ravi.expectedDays).toBe(3) // Thu, Fri, Sat
    expect(ravi.cells['2026-09-09']).toEqual({ kind: 'not_expected' })
    expect(ravi.unrecordedDates).toEqual(['2026-09-10', '2026-09-12'])
    expect(ravi.output.ratio).toBeNull()
  })

  it('reports how many days the sheet was filled', () => {
    expect(s.totals.expectedDates).toBe(6)
    expect(s.totals.emptyDates).toEqual(['2026-09-10'])
    expect(s.totals.partialDates).toEqual(['2026-09-12'])
    expect(s.totals.completeDates).toBe(4)
    expect(s.totals.flags).toBe(1)
  })

  it('day fill treats deactivation as effective from that day', () => {
    expect(isExpected(staff[2], '2026-07-31')).toBe(true)
    expect(isExpected(staff[2], '2026-08-01')).toBe(false)
    const fill = buildDayFill(staff, new Set([dayKey('a', '2026-09-14')]), '2026-09-14')
    expect(fill).toMatchObject({ expected: 2, recorded: 1, state: 'partial' })
    expect(fill.missing.map((m) => m.name)).toEqual(['Ravi'])
    expect(buildDayFill(staff, new Set(), '2026-09-13').state).toBe('not_expected')
  })
})
