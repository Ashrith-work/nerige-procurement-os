/**
 * One order, by hand.
 *
 * Exists so the vendor screen can be looked at before Pooja's side of the
 * product is built. It creates exactly the order the brief describes as done:
 * a weaver, a collection, eleven sold-out sarees tapped for restock, and one
 * new-design line carrying a note and three reference photographs.
 *
 * Snapshots are taken here, at creation, from the product row as it stands.
 * That is the whole point of those columns — a re-shoot next month must not
 * change the photograph on an order she already accepted.
 */
import type { Queryable } from './load'

export interface DemoOrderOptions {
  vendorCode?: string
  collection?: string
  restockCount?: number
  referenceCount?: number
  brief?: string
  createdBy?: string | null
}

export interface DemoOrderResult {
  orderId: string
  orderNumber: string
  vendorCode: string
  vendorName: string
  collection: string | null
  restockSkus: string[]
  referenceSkus: string[]
}

const DEFAULT_BRIEF =
  'Same weight and border as these, but in the deeper temple reds we sold out of in June. ' +
  'Six combinations if you can manage it, and keep the pallu plain.'

export async function seedDemoOrder(
  db: Queryable,
  opts: DemoOrderOptions = {},
): Promise<DemoOrderResult> {
  const vendorCode = (opts.vendorCode ?? 'HDR').toUpperCase()
  const restockCount = opts.restockCount ?? 11
  const referenceCount = opts.referenceCount ?? 3

  const { rows: vendorRows } = await db.query(
    `select id, display_name from vendors where code = $1 and deleted_at is null`,
    [vendorCode],
  )
  if (vendorRows.length === 0) throw new Error(`No vendor with code "${vendorCode}"`)
  const vendorId = vendorRows[0].id as string
  const vendorName = vendorRows[0].display_name as string

  // The pool, narrowed the way Pooja narrows it: one weaver, then one
  // collection, newest first. A photograph is required — a tile she cannot see
  // is a tile she cannot tap.
  const collection = opts.collection ?? (await busiestCollection(db, vendorId))

  const { rows: products } = await db.query(
    `select sku, title, description, image_url, qty_available
       from products
      where vendor_id = $1
        and collection = $2
        and qty_available <= 1
        and image_url is not null
      order by seq desc
      limit $3`,
    [vendorId, collection, restockCount + referenceCount],
  )

  if (products.length < restockCount + referenceCount) {
    throw new Error(
      `${vendorCode} / ${collection} has only ${products.length} usable designs; need ${
        restockCount + referenceCount
      }`,
    )
  }

  const restock = products.slice(0, restockCount)
  const references = products.slice(restockCount, restockCount + referenceCount)

  await db.query('begin')
  try {
    const { rows: orderRows } = await db.query(
      `insert into orders (batch_id, vendor_id, created_by)
       values (gen_random_uuid(), $1, $2)
       returning id, order_number`,
      [vendorId, opts.createdBy ?? null],
    )
    const orderId = orderRows[0].id as string
    const orderNumber = orderRows[0].order_number as string

    for (const p of restock) {
      await db.query(
        `insert into order_lines
           (order_id, line_type, sku, quantity, reorder_reason,
            snapshot_title, snapshot_image_url, snapshot_desc)
         values ($1, 'restock', $2, $3, $4, $5, $6, $7)`,
        [
          orderId,
          p.sku,
          // A weaver makes a small lot, not one piece.
          Number(p.qty_available) === 0 ? 6 : 4,
          Number(p.qty_available) === 0 ? 'sold_out' : 'last_piece',
          p.title,
          p.image_url,
          p.description,
        ],
      )
    }

    const { rows: lineRows } = await db.query(
      `insert into order_lines (order_id, line_type, brief, quantity)
       values ($1, 'new_design', $2, 6)
       returning id`,
      [orderId, opts.brief ?? DEFAULT_BRIEF],
    )
    const newDesignLineId = lineRows[0].id as string

    for (const ref of references) {
      await db.query(
        `insert into order_line_refs (order_line_id, sku, snapshot_image_url)
         values ($1, $2, $3)`,
        [newDesignLineId, ref.sku, ref.image_url],
      )
    }

    // The one-to-six rule is a deferred constraint trigger, so it is judged
    // here rather than on the insert above.
    await db.query('commit')

    return {
      orderId,
      orderNumber,
      vendorCode,
      vendorName,
      collection,
      restockSkus: restock.map((p) => p.sku as string),
      referenceSkus: references.map((p) => p.sku as string),
    }
  } catch (err) {
    await db.query('rollback')
    throw err
  }
}

/** Whichever of this weaver's collections has the most to reorder. */
async function busiestCollection(db: Queryable, vendorId: string): Promise<string> {
  const { rows } = await db.query(
    `select collection, count(*) as n
       from products
      where vendor_id = $1
        and qty_available <= 1
        and image_url is not null
        and collection is not null
      group by collection
      order by n desc
      limit 1`,
    [vendorId],
  )
  if (rows.length === 0) throw new Error('That vendor has nothing in the reorder pool')
  return rows[0].collection as string
}
