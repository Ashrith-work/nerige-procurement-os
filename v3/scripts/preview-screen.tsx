/**
 * Renders a vendor screen to a static HTML file, so it can be looked at before
 * there is a Supabase project to look at it in.
 *
 *   npm run preview:order
 *   npm run preview:catalogue
 *
 * Boots a throwaway Postgres, applies every migration, loads the real
 * catalogue, seeds one order by hand and renders THE SAME card components the
 * application renders — driven by a plain SQL read shaped exactly like the
 * PostgREST one. Real SKUs, real Kannada and Telugu titles, real descriptions,
 * real Shopify photographs.
 *
 * The one substitution is the photograph element: next/image reads its
 * configuration from a constant Next inlines at build time, so it cannot render
 * here. A plain <img> against the same `?width=800` URL occupies the same box.
 */
import EmbeddedPostgres from 'embedded-postgres'
import { Client } from 'pg'
import { renderToStaticMarkup } from 'react-dom/server'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
import { applyMigrations } from '../tests/harness/db'
import { loadSeed } from '../src/lib/seed/load'
import { seedDemoOrder } from '../src/lib/seed/demo-order'
import { toVendorOrder, shopifyImage, type RawOrder } from '../src/lib/orders/view'
import { getDictionary } from '../src/lib/i18n'
import { DesignCard, NoPhoto, type PhotoProps } from '../src/components/design-card'
import { StockLine } from '../src/components/stock-line'
import { OrderSections } from '../src/components/order-sections'

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? undefined : process.argv[i + 1]
}

const OUT = flag('out') ?? 'order-preview.html'

/** Stands in for next/image. Same box, same URL, no build-time config. */
function PlainPhoto({ url, alt, className }: PhotoProps) {
  const src = shopifyImage(url, 800)
  if (!src) return <NoPhoto className={className} />

  return (
    <div className={`relative overflow-hidden rounded-xl bg-stone-100 ${className ?? ''}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} className="absolute inset-0 h-full w-full object-cover" />
    </div>
  )
}

/** The same shape the PostgREST select produces, built in SQL. */
const ORDER_QUERY = `
  select
    o.id, o.order_number, o.status, o.issued_at, o.promised_date,
    o.dispatched_at, o.transport_docket,
    coalesce((
      select json_agg(line order by line->>'line_type' desc, line->>'id')
        from (
          select json_build_object(
            'id', ol.id, 'line_type', ol.line_type, 'sku', ol.sku, 'brief', ol.brief,
            'quantity', ol.quantity, 'reorder_reason', ol.reorder_reason,
            'snapshot_title', ol.snapshot_title, 'snapshot_image_url', ol.snapshot_image_url,
            'snapshot_desc', ol.snapshot_desc,
            'order_line_refs', coalesce((
              select json_agg(json_build_object('sku', r.sku, 'snapshot_image_url', r.snapshot_image_url))
                from order_line_refs r where r.order_line_id = ol.id
            ), '[]'::json)
          ) as line
          from order_lines ol where ol.order_id = o.id
        ) lines
    ), '[]'::json) as order_lines
  from orders o where o.id = $1
`

/** The vendor catalogue: the same card, with a stock line and its age. */
async function renderCatalogue(
  client: Client,
  collection: string,
  vendorCode: string,
  t: ReturnType<typeof getDictionary>,
): Promise<string> {
  const { rows } = await client.query(
    `select p.sku, p.title, p.description, p.image_url, p.qty_available, p.stock_synced_at
       from products p join vendors v on v.id = p.vendor_id
      where v.code = $1 and p.collection = $2
      order by p.seq desc limit 12`,
    [vendorCode, collection],
  )

  return renderToStaticMarkup(
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6">
      <div className="no-print">
        <h1 className="text-lg font-medium tracking-tight">{t.catalogue.title}</h1>
        <p className="text-sm text-stone-500">{t.catalogue.everyDesign}</p>
      </div>
      <h2 className="text-base font-medium text-stone-900">
        {collection}{' '}
        <span className="font-normal text-stone-400 tabular-nums">
          {t.catalogue.designsCount.replace('{n}', String(rows.length))}
        </span>
      </h2>
      <div className="columns-1 gap-4 sm:columns-2 lg:columns-3 print:columns-2">
        {rows.map((d) => (
          <div key={d.sku} className="mb-4">
            <DesignCard
              sku={d.sku}
              title={d.title}
              imageUrl={d.image_url}
              Photo={PlainPhoto}
              footer={<StockLine qty={d.qty_available} syncedAt={d.stock_synced_at} t={t} />}
            />
          </div>
        ))}
      </div>
    </div>,
  )
}

async function main() {
  const dataDir = await mkdtemp(join(tmpdir(), 'nerige-preview-'))
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'postgres',
    password: 'postgres',
    port: 54332,
    persistent: false,
    // Same reason as tests/harness/db.ts: initdb otherwise inherits the host
    // locale, which on a Windows machine is WIN1252, and the migrations contain
    // UTF-8 characters with no WIN1252 equivalent. Without this, the preview
    // dies on `20260804000200_identity.sql` — the one screen this script exists
    // to let you look at without a Supabase project.
    initdbFlags: ['-E', 'UTF8', '--locale=C'],
  })

  console.log('Booting Postgres')
  await pg.initialise()
  await pg.start()
  await pg.createDatabase('nerige_preview')

  const client = new Client({
    host: 'localhost',
    port: 54332,
    user: 'postgres',
    password: 'postgres',
    database: 'nerige_preview',
  })
  await client.connect()

  try {
    await applyMigrations(client)
    console.log('Loading the catalogue')
    await loadSeed(client, {
      productsCsvPath: join(process.cwd(), '..', 'v2', 'seed_products_full.csv'),
      poolCsvPath: join(process.cwd(), '..', 'v2', 'seed_reorder_pool.csv'),
      allowDuplicateSkus: true,
    })

    const vendorCode = flag('vendor') ?? 'HDR'
    const demo = await seedDemoOrder(client, { vendorCode })
    console.log(`Seeded ${demo.orderNumber} — ${demo.vendorName} / ${demo.collection}`)

    const { rows } = await client.query(ORDER_QUERY, [demo.orderId])
    const order = toVendorOrder(rows[0] as unknown as RawOrder)
    const t = getDictionary('en')

    const screen = flag('screen') ?? 'order'
    const body =
      screen === 'catalogue'
        ? await renderCatalogue(client, demo.collection ?? 'VINT', vendorCode, t)
        : renderToStaticMarkup(
      <div className="mx-auto max-w-md space-y-8 px-4 py-6 pb-10">
        <header className="space-y-1">
          <div className="flex items-center justify-between gap-3">
            <h1 className="font-mono text-base text-stone-900">{order.orderNumber}</h1>
            <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-amber-600/20 ring-inset">
              {order.status}
            </span>
          </div>
          <p className="text-sm text-stone-500">
            {t.order.orderFrom} · {t.order.issued} 5 Aug 2026
          </p>
        </header>

        <OrderSections order={order} t={t} Photo={PlainPhoto} />

        <section className="space-y-4 border-t border-stone-200 pt-6">
          <label className="block space-y-1.5">
            <span className="block text-sm font-medium text-stone-700">
              {t.order.promisedDate}
              <span className="ml-0.5 text-red-600">*</span>
            </span>
            <input
              type="date"
              defaultValue="2026-08-26"
              className="min-h-11 w-full rounded-lg border border-stone-300 bg-white px-3 text-base"
            />
            <span className="block text-xs text-stone-500">{t.order.promisedDateHint}</span>
          </label>
          <button className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-stone-900 px-4 text-sm font-medium text-white">
            {t.order.accept}
          </button>
        </section>
      </div>,
          )

    console.log('Compiling styles')
    const css = await postcss([tailwind()]).process('@import "tailwindcss";', {
      from: join(process.cwd(), 'src', 'app', 'globals.css'),
    })

    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${order.orderNumber} — vendor order screen</title>
<style>${css.css}</style>
<style>body{background:#fff;color:#1c1917;font-family:ui-sans-serif,system-ui,sans-serif;font-weight:400}</style>
</head>
<body>${body}</body>
</html>`

    await writeFile(OUT, html, 'utf8')
    console.log(`\n  Wrote ${OUT}`)
    console.log(`  ${order.restock.length} restock cards, ${order.newDesigns.length} new design card`)
  } finally {
    await client.end()
    await pg.stop()
    await rm(dataDir, { recursive: true, force: true })
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
