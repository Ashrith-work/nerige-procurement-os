/**
 * Fixture world for the isolation and workflow suites.
 *
 * Deliberately adversarial in shape: two competing vendors, each with real KYC,
 * bank details, documents, a catalogue, an issued order, a receipt in progress
 * and a submitted bill — plus a vendor with TWO logins. The two-login case
 * exists because the isolation unit is the vendor organisation, not the user —
 * if a policy accidentally keyed on user_id, Vendor A's second login would be
 * cut off from its own data and the bug would surface here rather than in
 * production.
 *
 * Every vendor-scoped table carries rows for BOTH vendors on purpose. The
 * isolation suite discovers those tables from the system catalog and asserts a
 * vendor sees none of the other's rows; on an empty table that assertion passes
 * without proving anything.
 */
import type { Client } from 'pg'

export interface VendorFixture {
  id: string
  ownerUser: string
  bankId: string
  docId: string
  seriesId: string
  /** Two live SKUs, the kind the vendor prints on a label. */
  productIds: string[]
  /** An issued purchase order: one restock line, one new-design brief. */
  poId: string
  restockLineId: string
  newDesignLineId: string
  /** A goods receipt left in draft so workflow tests can post it themselves. */
  grnId: string
  billId: string
  billDocId: string
}

export interface World {
  founder: string
  procurementHead: string
  warehouseManager: string
  vendorA: VendorFixture & { staffUser: string }
  vendorB: VendorFixture
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

interface VendorSeed {
  code: string
  name: string
  gstin: string
  createdBy: string
  /** SKU prefix, mirroring the live convention (shanwb14090). */
  skuPrefix: string
}

async function makeVendor(c: Client, opts: VendorSeed): Promise<Omit<VendorFixture, 'ownerUser'>> {
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

  // --- Catalogue -------------------------------------------------------------
  const series = await c.query<{ id: string }>(
    `insert into product_series (vendor_id, code, name, description, status, created_by)
     values ($1, 'WB', 'Woven Border', 'Mustard body, maroon border, gold zari', 'active', $2)
     returning id`,
    [vendorId, opts.createdBy],
  )
  const seriesId = series.rows[0].id

  const products = await c.query<{ id: string }>(
    `insert into products (vendor_id, series_id, sku, title, colour, fabric, cost_price, mrp)
     values
       ($1, $2, $3, 'Woven border saree — mustard', 'Mustard', 'Cotton silk', 1450.00, 3499.00),
       ($1, $2, $4, 'Woven border saree — indigo',  'Indigo',  'Cotton silk', 1450.00, 3499.00)
     returning id`,
    [vendorId, seriesId, `${opts.skuPrefix}wb14090`, `${opts.skuPrefix}wb14091`],
  )
  const productIds = products.rows.map((r) => r.id)

  // --- An issued order -------------------------------------------------------
  // Built as a draft and then issued, exactly as the application does it, so the
  // status machine and the totals trigger are exercised by the fixture itself.
  const po = await c.query<{ id: string }>(
    `insert into purchase_orders (vendor_id, title, required_by, created_by)
     values ($1, 'Week of 11 Aug', current_date + 14, $2)
     returning id`,
    [vendorId, opts.createdBy],
  )
  const poId = po.rows[0].id

  const restock = await c.query<{ id: string }>(
    `insert into purchase_order_lines
       (purchase_order_id, vendor_id, line_no, kind, product_id, quantity, unit_price)
     values ($1, $2, 1, 'restock', $3, 40, 1450.00)
     returning id`,
    [poId, vendorId, productIds[0]],
  )

  const newDesign = await c.query<{ id: string }>(
    `insert into purchase_order_lines
       (purchase_order_id, vendor_id, line_no, kind, series_id, description, colours,
        quantity, unit_price)
     values ($1, $2, 2, 'new_design', $3,
             'New series: teal body, gold temple border, six colour combinations',
             array['Teal', 'Rust', 'Olive'], 30, 1600.00)
     returning id`,
    [poId, vendorId, seriesId],
  )

  await c.query(`update purchase_orders set status = 'issued' where id = $1`, [poId])

  await c.query(
    `insert into purchase_order_messages (purchase_order_id, vendor_id, author_id, body, is_internal)
     values ($1, $2, $3, 'Please label every piece with the SKU on the order.', false),
            ($1, $2, $3, 'Check quality on this lot — last consignment had loose zari.', true)`,
    [poId, vendorId, opts.createdBy],
  )

  // --- A count in progress ---------------------------------------------------
  const grn = await c.query<{ id: string }>(
    `insert into goods_receipts (vendor_id, purchase_order_id, received_on)
     values ($1, $2, current_date) returning id`,
    [vendorId, poId],
  )
  await c.query(
    `insert into goods_receipt_lines
       (goods_receipt_id, vendor_id, purchase_order_line_id, quantity_ordered, quantity_received)
     values ($1, $2, $3, 40, 38)`,
    [grn.rows[0].id, vendorId, restock.rows[0].id],
  )

  // --- A bill awaiting review ------------------------------------------------
  const billDoc = await c.query<{ id: string }>(
    `insert into documents
       (vendor_id, owner_type, owner_id, kind, storage_path, file_name, mime_type, size_bytes)
     values ($1::uuid, 'vendor_bill', $1::uuid, 'other',
             'vendors/' || $1::text || '/bills/' || $2 || '.jpg', 'bill.jpg', 'image/jpeg', 90000)
     returning id`,
    [vendorId, opts.code],
  )
  await c.query(
    `insert into storage.objects (bucket_id, name)
     values ('vendor-documents', 'vendors/' || $1::text || '/bills/' || $2 || '.jpg')`,
    [vendorId, opts.code],
  )

  const bill = await c.query<{ id: string }>(
    `insert into vendor_bills
       (vendor_id, purchase_order_id, bill_number, bill_date,
        subtotal_amount, tax_amount, total_amount, document_id)
     values ($1, $2, $3, current_date, 58000.00, 2900.00, 60900.00, $4)
     returning id`,
    [vendorId, poId, `${opts.code}-0001`, billDoc.rows[0].id],
  )

  return {
    id: vendorId,
    bankId: bank.rows[0].id,
    docId: doc.rows[0].id,
    seriesId,
    productIds,
    poId,
    restockLineId: restock.rows[0].id,
    newDesignLineId: newDesign.rows[0].id,
    grnId: grn.rows[0].id,
    billId: bill.rows[0].id,
    billDocId: billDoc.rows[0].id,
  }
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
    skuPrefix: 'shan',
  })
  const b = await makeVendor(c, {
    code: 'ILKAL',
    name: 'Ilkal Weavers Co-op',
    gstin: '27AAPFU0939F1ZV',
    createdBy: procurementHead,
    skuPrefix: 'ilkal',
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
