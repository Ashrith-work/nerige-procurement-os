# Nerige Vendor Portal — build spec

One instruction, one build. Read all of it before writing code. Do not add anything not listed here.

---

## 1. What this is

A phone first portal with two kinds of user.

**Pooja, procurement head.** Browses sarees that have sold out or are down to the last piece, one vendor at a time, as a grid of photographs. Taps the ones she wants made again. Taps a few more and says "make me more in this direction". Presses send once. The system splits her taps by vendor and issues one order per vendor.

**The vendor.** Opens the portal on a phone. Sees only her own sarees. Sees the picture, the description and the code, large. Accepts the order. Writes those codes on the pieces before packing.

That is the whole product.

---

## 2. The model, stated once

**A SKU is a design, not a piece.** `PGW-BRHM-SLK-CRM-5855` is a cream Gadwal silk with a green and gold double zari border. Nerige may have owned four of them over two years. Each saree gets a serial number (`NS35012`) from the warehouse at inward. The SKU is what the vendor writes on the piece. The serial is what the warehouse writes.

**Sold out means it sold.** A saree at zero stock is not dead. It is proof of demand and a weaver can make it again from the photograph. Shopify marks these products `draft` once they sell out. Draft is not retired. **Never exclude a product from the reorder pool because Shopify calls it draft.** This is the single most important rule in this file.

**A brand new design carries no code.** If Pooja asks for something Nerige has never bought, it arrives unlabelled and the warehouse creates the product in EasyEcom at inward. The portal never invents a code and never issues code blocks.

**The SKU prefix is the vendor.** `PGW` is Pranav Gadwal, `HDR` is HDR, `SMT` is Saree Mart. This holds across all 53 vendor codes with no exceptions. Vendor isolation derives from the SKU string. Do not build a separate product to vendor mapping table.

---

## 3. An order has two sections

One order. Two sections. The vendor sees both on the same screen, clearly separated.

**Section one, restock.** Lines that name an existing SKU. The vendor weaves that saree again and writes that same existing code on it.

**Section two, new designs.** Lines that also point at existing SKUs, but only as reference. Pooja is saying "make me more like these". Nothing comes back with a code on it. Each line carries a free text note from Pooja and one to six reference SKUs with their photographs.

The only difference between the two sections is whether a code comes back with the saree. Make that difference loud on the vendor screen. A restock line shows the code large. A new design line shows the reference photographs and, in place of a code, the words "no code, we will label this on arrival".

---

## 4. Data

Two sources. Neither is enough alone. Join key is the SKU string.

| Field | Source |
|---|---|
| Quantity available | EasyEcom API |
| Image, description, title, price | Shopify |
| Vendor identity | SKU prefix, derived |

EasyEcom holds no images and no descriptions. Shopify holds no trustworthy warehouse stock. The portal is the only place the two meet. That is its reason to exist.

### Build against the seed files first

Two CSVs are supplied. Build the whole application against these, behind a loader that reads them into Postgres. Wire the EasyEcom API afterwards behind the same interface, changing only the loader.

**`seed_products_full.csv`** — 9,840 rows. Every SKU with vendor code, collection, fabric, colour code, sequence number, title, description, image URL, price, cost, quantity, Shopify status, product type.

**`seed_reorder_pool.csv`** — 8,903 rows. 7,795 sold out, 1,108 last piece. This is what Pooja browses. `reorder_reason` is `sold_out` or `last_piece`.

Largest vendors in the pool: HDR 2,045, PRS 1,019, SMT 892, PGW 734, SMC 598, TT 405. 53 vendors, 43 collections.

### Ordering the pool

8,903 rows cannot be read in one list, and none of them can be filtered away. So they are **narrowed by filter and then sorted**, never dropped.

Narrowing is always vendor first, then collection. Pooja works one weaver at a time. HDR plus Vintage is a browsable grid. All vendors at once is not, and the screen should not offer it as a default.

Default sort is the `seq` column, which is the trailing number in the SKU. It runs 1 to 15,549 across the whole catalogue and increases over time, so sorting descending puts the most recently added sarees first. This is free and available today.

**Leave a sort slot open.** A sales ranking file is coming later, from EasyEcom SKU Performance. When it arrives it becomes a `sales_rank` column on `products` and a new sort option, "fastest selling first". Build the sort as a named strategy behind one function so adding it later is one file, not a refactor. Do not model anything else around sales data now.

### EasyEcom, phase two

Read stock from the EasyEcom inventory endpoint. Use `Available`, not `On hand`. Available excludes pieces reserved against open orders, which is the number that answers "do we still have one". Store `stock_synced_at` per SKU and show the sync age in the UI. A stale number shown as live is worse than no number.

---

## 5. Screens

Six routes. No more.

### `/login`
Phone OTP for vendors, email magic link for Pooja. Supabase Auth.

### `/reorder` — Pooja, the primary screen

**A grid of photographs, not a list.** It should feel like browsing nerigestory.com, except tapping means "make this again".

- Vendor picker and collection picker at the top. Vendor is required. Nothing renders until a vendor is chosen.
- Below that, a photo grid. Two columns on a phone, four or five on desktop.
- Each tile: the photograph, the SKU in monospace underneath, a small badge for `Sold out` or `Last piece`. Tap the tile to select. Selected tiles get a 2px border and a tick in the corner.
- Long press or a small info button opens the title, description and price. Do not put description text on the tile.
- Search by SKU or title. Sort control with the default described above.
- Paginate or infinite scroll. A single vendor plus collection is usually under 500 tiles.

A sticky footer counts selections and splits them live, for example `14 selected · HDR 6 · PGW 5 · SMT 3`. One button, `Send to 3 vendors`.

Before sending, a review screen where Pooja can move any selected line from restock into the new design section, add her note, and attach further reference SKUs to it. Then confirm.

On confirm, create one `order` per vendor in a single transaction. All orders from one press share a `batch_id`.

### `/orders` and `/orders/[id]` — Pooja
Issued orders and their state. Read only apart from cancel.

### `/portal` — vendor home
Their orders grouped by what needs them: to accept, in progress, sent. Nothing else.

### `/portal/orders/[id]` — the screen this build is judged on

Two headed sections, restock first, then new designs. A vertical scroll of cards. One card fills most of a phone screen.

A restock card:

1. Image, full width, roughly 300px tall, object fit cover, 12px radius
2. SKU, monospace, 19px, weight 500, directly under the image
3. Title
4. Description, 14px, line height 1.5
5. Quantity wanted

A new design card:

1. Pooja's note, large, at the top
2. A horizontal strip of reference photographs
3. In place of a code, the line "no code, we will label this on arrival"
4. Quantity wanted

No table. No horizontal scroll on the card itself. Never truncate a SKU. The code is a string someone copies onto a fabric label by hand and it must be readable at arm's length.

Accept button at the bottom with a promised date. After accepting, the vendor can set a dispatch date and a transport docket number. That is all a vendor can write.

### `/portal/catalogue` — vendor, secondary
Every design the portal holds for this vendor. Same card layout. Grouped by collection, searchable, printable.

---

## 6. Schema

Keep four migrations from the existing repository:

- `20260804000100_foundation.sql`
- `20260804000200_identity.sql`
- `20260804000500_rls_helpers.sql`
- `20260804000600_rls_policies.sql`, rewritten for the tables below

Delete the rest. `vendor_kyc`, `catalogue`, `purchase_orders`, `receiving`, `billing`, `audit_and_outbox`, `storage` and `operations_rls` are out of scope. From `vendors`, strip GSTIN, PAN, MSME, Udyam, payment terms and bank fields. Keep `id`, `code`, `display_name`, `status`, `primary_phone`, `default_lead_time_days`.

```
products
  sku                text primary key
  vendor_id          uuid not null references vendors
  collection         text
  fabric             text
  colour_code        text
  seq                integer            -- trailing number, default sort
  sales_rank         integer            -- null until the sales file lands
  title              text
  description        text
  image_url          text
  price              numeric
  cost               numeric
  product_type       text
  shopify_status     text
  qty_available      integer not null default 0
  stock_synced_at    timestamptz
  last_ordered_at    timestamptz

orders
  id                 uuid primary key
  batch_id           uuid not null
  vendor_id          uuid not null references vendors
  order_number       text not null unique
  status             order_status not null default 'issued'
  issued_at          timestamptz not null default now()
  promised_date      date
  dispatched_at      timestamptz
  transport_docket   text
  created_by         uuid references app_users

order_lines
  id                 uuid primary key
  order_id           uuid not null references orders on delete cascade
  line_type          line_type not null          -- restock | new_design
  sku                text references products    -- required on restock, null on new_design
  brief              text                        -- required on new_design, null on restock
  quantity           integer not null default 1 check (quantity > 0)
  reorder_reason     text                        -- sold_out | last_piece
  snapshot_title     text
  snapshot_image_url text
  snapshot_desc      text

order_line_refs
  id                 uuid primary key
  order_line_id      uuid not null references order_lines on delete cascade
  sku                text not null references products
  snapshot_image_url text
```

`order_status`: `issued`, `accepted`, `dispatched`, `received`, `cancelled`.
`line_type`: `restock`, `new_design`.

Constrain it: a `restock` line must have a `sku` and no `brief`. A `new_design` line must have a `brief` and no `sku`. Reference SKUs in `order_line_refs` are only valid on `new_design` lines, one to six of them.

Snapshot title, image and description onto the line at creation. A vendor must see what was ordered, not what the record later became.

### Receiving, later

Receiving is not in this build. The warehouse continues to work in EasyEcom. But leave `quantity_received` on `order_lines`, nullable, so that when it is added it is a column rather than a rewrite. Restock lines will be found by SKU in EasyEcom and given a fresh serial. New design lines will become new EasyEcom products and go to the shoot area. Neither happens in this portal.

### Isolation

RLS enabled and forced on `products`, `orders`, `order_lines`, `order_line_refs`. Vendor policies resolve through `app.current_vendor_id()`. A vendor session must return zero rows belonging to any other vendor on all four tables. Assert this in a test suite that discovers vendor scoped tables from the system catalog rather than from a hand written list.

`order_lines` and `order_line_refs` carry no `vendor_id` of their own. Scope them through the parent order in the policy, not in application code.

---

## 7. Look

Flow and density from the Nerige Story storefront: white ground, generous whitespace, the photograph dominant, one clear action per screen. Pacing from wisprflow.ai: short screens, one decision at a time, no dense chrome.

- Phone first. Design at 380px and let it widen. Pooja's grid may go wider on desktop. Every vendor screen is a phone screen.
- 44px minimum touch targets.
- Text inputs 16px minimum, or iOS Safari zooms the viewport on focus.
- Two font weights, 400 and 500. Sentence case everywhere.
- Images through `next/image`, Shopify CDN in `remotePatterns`. `?width=400` for grid tiles, `?width=800` for vendor cards.
- Vendor facing strings go through a dictionary from day one, with `locale` on `app_users` for English, Kannada, Telugu, Tamil and Hindi. Retrofitting this is painful.

---

## 8. Out of scope

Do not build, do not add columns for, do not mention in the README: KYC, GSTIN or PAN validation, MSME ageing, bills, invoices, three way match, payment approval, goods receipt, quality control, audit trail, transactional outbox, n8n, analytics, vendor scorecards, sampling.

All of these were built before the vendor could see a photograph. That is the mistake this rebuild corrects.

---

## 9. Definition of done

1. Pooja logs in, picks HDR, picks the Vintage collection, browses a photo grid of sold out sarees, taps eleven, adds one new design line with three reference photographs, presses send once, and two orders exist.
2. The HDR vendor logs in on a phone and sees her restock cards with large photographs and large codes, and below them her new design card with reference photographs and no code.
3. She sees nothing belonging to any other vendor.
4. She accepts and sets a date. Pooja sees the date.
5. The isolation suite proves, against a real Postgres instance, that a vendor session reads zero rows from another vendor on every vendor scoped table.
6. Every quantity on screen carries a visible sync age.

Ship that. Nothing before it, nothing alongside it.
