/**
 * Migration smoke tests.
 *
 * Proves the schema applies cleanly to an empty database and that the
 * structural guarantees the plan depends on are actually in place — rather
 * than merely written down in a migration file.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestDb, type TestDb } from './harness/db'
import type { Client } from 'pg'

let db: TestDb

/**
 * Asserts a statement is rejected, isolated inside a savepoint.
 *
 * A failed statement aborts the enclosing transaction, so without this every
 * expected-failure assertion would poison the ones after it. The savepoint lets
 * a test assert several rejections in sequence.
 */
async function expectRejection(c: Client, sql: string, params: unknown[], pattern: RegExp) {
  await c.query('savepoint probe')
  try {
    await c.query(sql, params)
    throw new Error(`Expected rejection matching ${pattern}, but the statement succeeded`)
  } catch (err) {
    const message = (err as Error).message
    expect(message).toMatch(pattern)
  } finally {
    await c.query('rollback to savepoint probe')
  }
}

beforeAll(async () => {
  db = await getTestDb()
})

afterAll(async () => {
  await db?.stop()
})

describe('schema', () => {
  it('applies every migration cleanly', async () => {
    const { rows } = await db.client.query<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE'
        order by table_name`,
    )
    const tables = rows.map((r) => r.table_name)

    expect(tables).toEqual([
      'app_users',
      'audit_log',
      'documents',
      'events',
      'goods_receipt_lines',
      'goods_receipts',
      'product_series',
      'products',
      'purchase_order_lines',
      'purchase_order_messages',
      'purchase_orders',
      'vendor_addresses',
      'vendor_bank_accounts',
      'vendor_bills',
      'vendor_contacts',
      'vendor_users',
      'vendors',
    ])
  })

  it('enables AND forces RLS on every public table', async () => {
    // FORCE matters: without it, anything connecting as the table owner
    // bypasses all policies silently.
    const { rows } = await db.client.query<{
      relname: string
      relrowsecurity: boolean
      relforcerowsecurity: boolean
    }>(
      `select c.relname, c.relrowsecurity, c.relforcerowsecurity
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
        order by c.relname`,
    )

    const unprotected = rows.filter((r) => !r.relrowsecurity || !r.relforcerowsecurity)
    expect(unprotected.map((r) => r.relname)).toEqual([])
  })

  it('pins search_path on every SECURITY DEFINER function', async () => {
    // An unpinned SECURITY DEFINER function is a privilege-escalation hole:
    // a caller who can create objects earlier on the search path can shadow
    // app_users and impersonate any vendor.
    const { rows } = await db.client.query<{ nspname: string; proname: string }>(
      `select n.nspname, p.proname
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where p.prosecdef
          and n.nspname in ('app', 'public')
          and not exists (
            select 1 from unnest(coalesce(p.proconfig, '{}')) cfg
             where cfg like 'search_path=%'
          )`,
    )
    expect(rows.map((r) => `${r.nspname}.${r.proname}`)).toEqual([])
  })

  it('grants nothing to anon anywhere in public', async () => {
    const { rows } = await db.client.query<{ table_name: string; privilege_type: string }>(
      `select table_name, privilege_type
         from information_schema.role_table_grants
        where grantee = 'anon' and table_schema = 'public'`,
    )
    expect(rows).toEqual([])
  })

  it('leaves the events outbox closed to all authenticated clients', async () => {
    const { rows } = await db.client.query(
      `select privilege_type from information_schema.role_table_grants
        where grantee = 'authenticated' and table_schema = 'public' and table_name = 'events'`,
    )
    expect(rows).toEqual([])
  })
})

describe('audit log', () => {
  it('is append-only even for the owner', async () => {
    await db.asAdmin(async (c) => {
      await c.query('begin')
      try {
        await c.query(`insert into audit_log (table_name, action) values ('probe', 'insert')`)
        await expectRejection(
          c,
          `update audit_log set table_name = 'tampered' where table_name = 'probe'`,
          [],
          /append-only/i,
        )
        await expectRejection(
          c,
          `delete from audit_log where table_name = 'probe'`,
          [],
          /append-only/i,
        )
      } finally {
        await c.query('rollback')
      }
    })
  })
})

describe('soft delete', () => {
  it('refuses hard DELETE on vendors', async () => {
    await db.asAdmin(async (c) => {
      await c.query('begin')
      try {
        const { rows } = await c.query<{ id: string }>(
          `insert into vendors (code, legal_name, display_name, gst_registration_type)
           values ('HARDDEL', 'Hard Delete Test', 'Hard Delete', 'unregistered')
           returning id`,
        )
        await expectRejection(
          c,
          'delete from vendors where id = $1',
          [rows[0].id],
          /Hard delete is not permitted/i,
        )
      } finally {
        await c.query('rollback')
      }
    })
  })
})

describe('India statutory guards', () => {
  it('caps MSME vendor payment terms at 45 days (s.43B(h))', async () => {
    await db.asAdmin(async (c) => {
      await c.query('begin')
      try {
        await expectRejection(
          c,
          `insert into vendors
             (code, legal_name, display_name, gst_registration_type,
              msme_category, udyam_number, payment_terms_days)
           values ('MSMEX', 'Msme Over Terms', 'Msme Over', 'unregistered',
                   'small', 'UDYAM-KA-03-1234567', 60)`,
          [],
          /cannot exceed 45 days/i,
        )
      } finally {
        await c.query('rollback')
      }
    })
  })

  it('derives state_code and PAN from a supplied GSTIN', async () => {
    await db.asAdmin(async (c) => {
      await c.query('begin')
      try {
        const { rows } = await c.query<{ state_code: string; pan: string }>(
          `insert into vendors (code, legal_name, display_name, gstin)
           values ('GSTDERIV', 'Gst Derive Test', 'Gst Derive', '29AABCU9603R1ZJ')
           returning state_code, pan`,
        )
        // 29 = Karnataka; PAN occupies GSTIN positions 3..12.
        expect(rows[0].state_code).toBe('29')
        expect(rows[0].pan).toBe('AABCU9603R')
      } finally {
        await c.query('rollback')
      }
    })
  })

  it('rejects a regular-GST vendor with no GSTIN', async () => {
    await db.asAdmin(async (c) => {
      await c.query('begin')
      try {
        await expectRejection(
          c,
          `insert into vendors (code, legal_name, display_name, gst_registration_type)
           values ('NOGST', 'No Gstin', 'No Gstin', 'regular')`,
          [],
          /vendors_regular_needs_gstin/i,
        )
      } finally {
        await c.query('rollback')
      }
    })
  })

  it('rejects an MSME claim with no Udyam number', async () => {
    await db.asAdmin(async (c) => {
      await c.query('begin')
      try {
        await expectRejection(
          c,
          `insert into vendors (code, legal_name, display_name, gst_registration_type, msme_category)
           values ('NOUDYAM', 'No Udyam', 'No Udyam', 'unregistered', 'micro')`,
          [],
          /vendors_msme_needs_udyam/i,
        )
      } finally {
        await c.query('rollback')
      }
    })
  })
})

describe('document storage layout', () => {
  it('rejects a storage path outside the vendor isolation prefix', async () => {
    await db.asAdmin(async (c) => {
      await c.query('begin')
      try {
        const { rows } = await c.query<{ id: string }>(
          `insert into vendors (code, legal_name, display_name, gst_registration_type)
           values ('DOCPATH', 'Doc Path Test', 'Doc Path', 'unregistered')
           returning id`,
        )
        // The bucket policy derives the owning vendor by parsing this path, so a
        // non-conforming path must never reach the table.
        await expectRejection(
          c,
          `insert into documents
             (vendor_id, owner_type, owner_id, storage_path, file_name, mime_type, size_bytes)
           values ($1, 'vendor', $1, 'public/anything.pdf', 'x.pdf', 'application/pdf', 100)`,
          [rows[0].id],
          /documents_vendor_path_prefix/i,
        )
      } finally {
        await c.query('rollback')
      }
    })
  })
})
