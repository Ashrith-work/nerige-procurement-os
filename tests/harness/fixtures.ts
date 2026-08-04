/**
 * Fixture world for the isolation suite.
 *
 * Deliberately adversarial in shape: two competing vendors, each with real KYC,
 * bank details and documents, plus a vendor with TWO logins. The two-login case
 * exists because the isolation unit is the vendor organisation, not the user —
 * if a policy accidentally keyed on user_id, Vendor A's second login would be
 * cut off from its own data and the bug would surface here rather than in
 * production.
 */
import type { Client } from 'pg'

export interface World {
  founder: string
  procurementHead: string
  warehouseManager: string
  vendorA: { id: string; ownerUser: string; staffUser: string; bankId: string; docId: string }
  vendorB: { id: string; ownerUser: string; bankId: string; docId: string }
}

async function makeAuthUser(c: Client, email: string | null, phone: string | null) {
  const { rows } = await c.query<{ id: string }>(
    'insert into auth.users (email, phone) values ($1, $2) returning id',
    [email, phone],
  )
  return rows[0].id
}

async function makeAppUser(
  c: Client,
  opts: { role: string; name: string; email?: string; phone?: string },
) {
  const authId = await makeAuthUser(c, opts.email ?? null, opts.phone ?? null)
  await c.query(
    `insert into app_users (id, role, status, full_name, email, phone)
     values ($1, $2::app_role, 'active', $3, $4, $5)`,
    [authId, opts.role, opts.name, opts.email ?? null, opts.phone ?? null],
  )
  return authId
}

async function makeVendor(
  c: Client,
  opts: { code: string; name: string; gstin: string; createdBy: string },
) {
  const { rows } = await c.query<{ id: string }>(
    `insert into vendors (code, legal_name, display_name, gstin, created_by, status)
     values ($1, $2, $2, $3, $4, 'active') returning id`,
    [opts.code, opts.name, opts.gstin, opts.createdBy],
  )
  const vendorId = rows[0].id

  const bank = await c.query<{ id: string }>(
    `insert into vendor_bank_accounts
       (vendor_id, account_holder_name, account_number, ifsc, bank_name)
     values ($1, $2, $3, $4, 'Test Bank') returning id`,
    [vendorId, opts.name, `9${opts.code.length}001234567`, 'HDFC0001234'],
  )

  await c.query(
    `insert into vendor_addresses
       (vendor_id, kind, line1, city, state, state_code, pincode, is_primary)
     values ($1, 'registered', '1 Loom Street', 'Bengaluru', 'Karnataka', '29', '560001', true)`,
    [vendorId],
  )

  await c.query(
    `insert into vendor_contacts (vendor_id, name, phone, purposes, is_primary)
     values ($1, $2, '+919812345678', array['orders'], true)`,
    [vendorId, `${opts.name} Owner`],
  )

  const doc = await c.query<{ id: string }>(
    `insert into documents
       (vendor_id, owner_type, owner_id, kind, storage_path, file_name, mime_type, size_bytes)
     values ($1::uuid, 'vendor', $1::uuid, 'gst_certificate',
             'vendors/' || $1::text || '/kyc/gst.pdf', 'gst.pdf', 'application/pdf', 5000)
     returning id`,
    [vendorId],
  )

  // The physical object, so storage-bucket policies can be tested too.
  await c.query(
    `insert into storage.objects (bucket_id, name)
     values ('vendor-documents', 'vendors/' || $1::text || '/kyc/gst.pdf')`,
    [vendorId],
  )

  return { id: vendorId, bankId: bank.rows[0].id, docId: doc.rows[0].id }
}

/**
 * Builds the world. Runs privileged, because fixture setup is not the thing
 * under test — the assertions that follow all run as `authenticated`.
 */
export async function seedWorld(c: Client): Promise<World> {
  const founder = await makeAppUser(c, {
    role: 'founder',
    name: 'Founder',
    email: 'founder@nerigestory.test',
  })
  const procurementHead = await makeAppUser(c, {
    role: 'procurement_head',
    name: 'Procurement Head',
    email: 'procurement@nerigestory.test',
  })
  const warehouseManager = await makeAppUser(c, {
    role: 'warehouse_manager',
    name: 'Warehouse Manager',
    email: 'warehouse@nerigestory.test',
  })

  const a = await makeVendor(c, {
    code: 'SHAN',
    name: 'Shantiniketan Handlooms',
    gstin: '29AABCU9603R1ZJ',
    createdBy: procurementHead,
  })
  const b = await makeVendor(c, {
    code: 'ILKAL',
    name: 'Ilkal Weavers Co-op',
    gstin: '27AAPFU0939F1ZV',
    createdBy: procurementHead,
  })

  const aOwner = await makeAppUser(c, {
    role: 'vendor',
    name: 'Shantiniketan Owner',
    phone: '+919000000001',
  })
  // Second login for the SAME organisation — proves org-level, not user-level,
  // isolation.
  const aStaff = await makeAppUser(c, {
    role: 'vendor',
    name: 'Shantiniketan Manager',
    phone: '+919000000002',
  })
  const bOwner = await makeAppUser(c, {
    role: 'vendor',
    name: 'Ilkal Owner',
    phone: '+919000000003',
  })

  await c.query(
    `insert into vendor_users (vendor_id, user_id, is_owner) values
       ($1, $2, true), ($1, $3, false), ($4, $5, true)`,
    [a.id, aOwner, aStaff, b.id, bOwner],
  )

  return {
    founder,
    procurementHead,
    warehouseManager,
    vendorA: { ...a, ownerUser: aOwner, staffUser: aStaff },
    vendorB: { ...b, ownerUser: bOwner },
  }
}
