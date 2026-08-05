/**
 * Fixture world for the isolation suite.
 *
 * Deliberately adversarial in shape: two competing weavers with the SAME shape
 * of data on every vendor-scoped table, plus a weaver with two logins.
 *
 * Both halves matter. Identical shapes mean the suite's central assertion — a
 * vendor sees zero of the other's rows — is actually testing something; on an
 * empty table that assertion passes without proving anything. The second login
 * exists because the unit of isolation is the vendor ORGANISATION, not the
 * user: if a policy accidentally keyed on user_id, vendor A's manager would be
 * cut off from her own orders and the bug would surface here rather than in
 * production.
 */
import type { Client } from 'pg'

export interface VendorFixture {
  id: string
  code: string
  ownerUser: string
  /** Three designs, the kind a weaver prints on a label. */
  skus: string[]
  orderId: string
  restockLineId: string
  newDesignLineId: string
}

export interface World {
  pooja: string
  suspended: string
  vendorA: VendorFixture & { staffUser: string }
  vendorB: VendorFixture
}

async function makeUser(
  c: Client,
  opts: { role: 'procurement_head' | 'vendor'; name: string; email?: string; phone?: string },
): Promise<string> {
  const { rows } = await c.query<{ id: string }>(
    'insert into auth.users (email, phone) values ($1, $2) returning id',
    [opts.email ?? null, opts.phone ?? null],
  )
  const id = rows[0].id
  await c.query(
    `insert into app_users (id, role, status, full_name, email, phone)
     values ($1, $2::app_role, 'active', $3, $4, $5)`,
    [id, opts.role, opts.name, opts.email ?? null, opts.phone ?? null],
  )
  return id
}

async function makeVendor(
  c: Client,
  opts: { code: string; name: string; phoneSuffix: string },
): Promise<VendorFixture> {
  const { rows } = await c.query<{ id: string }>(
    `insert into vendors (code, display_name) values ($1, $2) returning id`,
    [opts.code, opts.name],
  )
  const vendorId = rows[0].id

  // Three designs: one sold out, one last piece, one still in stock. The pool
  // predicate is `qty_available in (0, 1)`, so this covers both sides of it.
  const skus = [1, 2, 3].map((n) => `${opts.code}-VINT-SLK-RED-${n}0${opts.phoneSuffix}`)
  await c.query(
    `insert into products
       (sku, vendor_id, collection, fabric, colour_code, seq, title, description,
        image_url, price, cost, product_type, shopify_status, qty_available, stock_synced_at)
     select
       s, $1, 'VINT', 'SLK', 'RED', 100 + i, 'Design ' || i, 'A red silk saree.',
       'https://cdn.shopify.com/s/files/1/0/0/files/x' || i || '.jpg',
       3499.00, 1200.00, 'SAREES',
       -- draft, because Shopify drafts a product the moment it sells out. If a
       -- policy or a query ever started filtering on this, the pool would empty.
       case when i = 3 then 'active' else 'draft' end,
       case i when 1 then 0 when 2 then 1 else 4 end,
       now()
     from unnest($2::text[]) with ordinality as t(s, i)`,
    [vendorId, skus],
  )

  const order = await c.query<{ id: string }>(
    `insert into orders (batch_id, vendor_id) values (gen_random_uuid(), $1) returning id`,
    [vendorId],
  )
  const orderId = order.rows[0].id

  const restock = await c.query<{ id: string }>(
    `insert into order_lines
       (order_id, line_type, sku, quantity, reorder_reason,
        snapshot_title, snapshot_image_url, snapshot_desc)
     values ($1, 'restock', $2, 6, 'sold_out', 'Design 1', 'https://cdn.shopify.com/x1.jpg', 'A red silk saree.')
     returning id`,
    [orderId, skus[0]],
  )

  const newDesign = await c.query<{ id: string }>(
    `insert into order_lines (order_id, line_type, brief, quantity)
     values ($1, 'new_design', 'More in this direction, deeper reds.', 6)
     returning id`,
    [orderId],
  )

  await c.query(
    `insert into order_line_refs (order_line_id, sku, snapshot_image_url)
     select $1, s, 'https://cdn.shopify.com/ref.jpg' from unnest($2::text[]) as t(s)`,
    [newDesign.rows[0].id, skus.slice(1)],
  )

  return {
    id: vendorId,
    code: opts.code,
    ownerUser: '',
    skus,
    orderId,
    restockLineId: restock.rows[0].id,
    newDesignLineId: newDesign.rows[0].id,
  }
}

/**
 * Builds the world in ONE transaction.
 *
 * Not for speed: the one-to-six rule on reference SKUs is a deferred constraint
 * trigger, so a new-design line inserted on its own autocommit would be judged
 * before its references exist and refused.
 *
 * Runs privileged, because fixture setup is not the thing under test — every
 * assertion that follows runs as `authenticated`.
 */
export async function seedWorld(c: Client): Promise<World> {
  await c.query('begin')
  try {
    const pooja = await makeUser(c, {
      role: 'procurement_head',
      name: 'Pooja',
      email: 'pooja@nerige.test',
    })

    const a = await makeVendor(c, { code: 'AAA', name: 'Anantha Handlooms', phoneSuffix: '1' })
    const b = await makeVendor(c, { code: 'BBB', name: 'Bhavani Weavers', phoneSuffix: '2' })

    const aOwner = await makeUser(c, { role: 'vendor', name: 'A owner', phone: '+919000000001' })
    // Second login for the SAME organisation.
    const aStaff = await makeUser(c, { role: 'vendor', name: 'A manager', phone: '+919000000002' })
    const bOwner = await makeUser(c, { role: 'vendor', name: 'B owner', phone: '+919000000003' })

    const suspended = await makeUser(c, {
      role: 'vendor',
      name: 'B former manager',
      phone: '+919000000004',
    })

    await c.query(
      `insert into vendor_users (vendor_id, user_id, is_owner) values
         ($1, $2, true), ($1, $3, false), ($4, $5, true), ($4, $6, false)`,
      [a.id, aOwner, aStaff, b.id, bOwner, suspended],
    )
    await c.query(`update app_users set status = 'suspended' where id = $1`, [suspended])

    await c.query('commit')

    return {
      pooja,
      suspended,
      vendorA: { ...a, ownerUser: aOwner, staffUser: aStaff },
      vendorB: { ...b, ownerUser: bOwner },
    }
  } catch (err) {
    await c.query('rollback')
    throw err
  }
}
