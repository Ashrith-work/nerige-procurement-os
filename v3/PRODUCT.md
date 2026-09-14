# Nerige OS — what has been built

A procurement and product system for a handloom saree business. One application,
two audiences: the **weaver**, who sees her own designs and the orders placed
with her, and the **Nerige team**, who decide what gets made again.

This document is the product-level picture. `README.md` alongside it is the
implementation detail; the migration files carry the reasoning for every schema
decision, and are worth reading before changing any of them.

**Live:** https://nerige-procurement-os.vercel.app
**Status as of 2026-08-21:** in production with real catalogue data. No orders
have been issued yet.

---

## The two ideas everything rests on

**1. The SKU is the design, and its prefix is the weaver.**

A SKU reads `VENDOR-COLLECTION-FABRIC-COLOUR-SEQ` — `PGW-BRHM-SLK-CRM-5855`.
There is deliberately no product↔vendor mapping table. Ownership is derived from
the string, which means a saree can never belong to a weaver who does not exist,
and a new saree cannot be minted under a prefix with no weaver behind it.

The cost of that choice is real and is handled explicitly: a SKU with no hyphen
names no weaver at all, and those go to a holding pen rather than inventing one.
See *The holding pen* below.

**2. A weaver sees her own rows and nothing else, enforced by the database.**

Isolation is row-level security in Postgres, not filtering in application code. A
missing `WHERE` clause in a query cannot leak another weaver's designs, because
the policy applies underneath the query. Views are `security_invoker` so they
inherit the same policies rather than bypassing them.

The test suite boots a throwaway Postgres, runs all 30 migrations, and asserts
both halves on every vendor-scoped relation it can discover: that a weaver sees
none of another's rows, and that she sees all of her own. **39 tests, all
passing.**

---

## Where the data stands

| | |
|---|---|
| Products | 10,160 |
| Weavers | 52, plus one holding pen |
| Vocabulary codes discovered | 100 — 20 collections, 20 fabrics, 60 colours |
| Sales history | 7,868 SKU-day rows, ~400 days |
| In the reorder pool | 9,218 |
| Logins | 7 — 2 admin, 5 weaver |
| Orders issued | 0 |

The catalogue arrives from Shopify. Nothing is typed in by hand.

---

## Roles

Five roles, one sign-in form. There is no admin/vendor toggle: the role in
`app_users` decides where you land, so nobody can pick the wrong door, and the
login box does not leak which roles exist.

| Role | Lands on | Can |
|---|---|---|
| `admin` | `/reorder` | Everything. Exclusive on corrections, image edits, vendor identification and account approval |
| `procurement_head` | `/reorder` | Reorder, orders, vendors, insights, purchase orders |
| `warehouse_manager` | `/intake/queue` *(not built)* | Submit and track new product intake |
| `customer_support` | `/lookup` *(not built)* | Read-only lookup |
| `vendor` | `/portal` | Her own designs and her own orders |

A weaver's user ID is a short handle — `hdr` — mapped internally to
`hdr@vendor.nerige.internal`. That domain cannot receive mail, deliberately:
there is no magic link, no password reset email, and no signup path that could
try to deliver anything. Accounts are created with the address pre-confirmed.

---

## The screens

### For the weaver — `/portal`

Every screen is a phone screen, and the photograph dominates it.

- **`/portal`** — her orders.
- **`/portal/catalogue`** — every design she has made, newest first, narrowed by
  collection, colour or fabric with counts on each option.
- **`/portal/orders/[id]`** — one order: what to make again, and what to make new.

Fully translated into English, Kannada, Tamil, Telugu and Hindi. The language
belongs to the *weaving house* (`vendors.default_locale`), so a second login at
the same house inherits it; a weaver can override it for herself from her own
header.

### For the Nerige team

- **`/reorder`** — the grid. One vendor, then one collection, then a sort. 9,218
  designs cannot be read as a list, so they are narrowed and sorted, never
  dropped.
- **`/reorder/review`** — the last step before orders exist. Any saree can be
  reordered, asked for as a new design "more in this direction", or both.
- **`/orders`, `/orders/[id]`** — issued orders, purchase order PDFs, delivery.
- **`/admin/products`** — the whole catalogue, with a sell-through period
  selector and stock on every card.
- **`/admin/products/[sku]`** — one design, with the image editor.
- **`/admin/products/unidentified`** — the holding pen.
- **`/admin/vendors`, `/admin/vendors/[code]`, `/admin/vendors/new`** — weavers,
  their credentials, and impersonation for support.
- **`/admin/signups`** — account requests awaiting approval.
- **`/admin/insights`** — sales analysis, with CSV export.
- **`/admin/settings`** — sync status, integrations, tutorial films.

### Public

- **`/login`** — one form for everybody.
- **`/signup`** — request an account. Creates nothing on its own.

---

## The reorder ladder

The default sort is not a single column. It is four rungs, and within a rung,
units sold in the chosen window:

1. **Selling** — sold within the window
2. **Slowing** — sold within the year, but not the window
3. **In stock, not moving** — unsold in a year, stock remains
4. **Dormant** — unsold in a year, nothing left

The point is that before this existed, a saree that sold out yesterday and one
that had not sold since 2024 were indistinguishable on the grid: both read
`qty_available: 0`, and both looked like proof of demand. Only one of them was.

The tiers are precomputed columns (`tier_30`, `tier_60`, `tier_90`) because
PostgREST cannot put a `CASE` in an `ORDER BY`, and each has a partial index
covering the whole access path.

---

## Stock, and what the numbers mean

`products.qty_available` is **Shopify's available quantity** —
`ProductVariant.inventoryQuantity`, verified to equal `on_hand − committed`. It
already excludes pieces owed to open customer orders.

It goes **negative** when a design oversells: `-118` means 168 pieces are owed
against 50 held, so 118 customers have paid for a saree that does not exist yet.
That is the strongest possible reason to ask a weaver for more, and such designs
are in the reorder pool — the predicate is `qty_available <= 1`.

**Sell-through** is `units sold in the period ÷ (units sold + stock still held)`,
offered over 30, 60, 90 or 365 days. The textbook denominator is *units
received*, which this system has never recorded — there is no goods-inward event
anywhere in the schema — so sold-plus-remaining reconstructs the starting
quantity exactly, *provided nothing arrived mid-period*. A design restocked twice
during the window therefore reads slower than it was. That bias is stated rather
than hidden.

It can be **null**, and null is not zero. Nothing sold and nothing held is `0/0`
— not "sold none of them" but a design we neither hold nor moved. That is roughly
7,000 of the 10,160, which is why those cards show nothing at all rather than a
confident `0%`.

`shopify_qty_available`, `reserved_qty` and `stock_variance` exist and are
dormant. They are the shape this takes if a second, independent stock source
(EasyEcom) is ever wired, at which point the variance between the two becomes the
signal.

---

## The holding pen

100 products carry a SKU with no hyphen — `VINTWB14700` and the like. The vendor
derivation takes the first segment, which for those *is the entire SKU*, so the
first full sync created 100 "weavers" each owning exactly one product named after
itself.

They are not dropped, because they are real sellable sarees and only our
knowledge of who made them is missing. They are parked against a placeholder
vendor (`UNIDENTIFIED`, flagged `is_placeholder`) and assigned at
`/admin/products/unidentified` — a photograph with a weaver dropdown beside it,
because nobody identifies a weaver from `VINTWB14700` but they often can from the
border and the weave. Sorted by what each sells, since a design in the pen cannot
be reordered at all.

The sync can move a product **out** of the holding pen and never back into it: the
SKU shape never changes, so it would otherwise undo the assignment on every run.

---

## Signup and approval

A signup request is an *asking*. It carries no authority and creates no account.

A stranger reaches exactly one `SECURITY DEFINER` function, `request_signup` —
`anon` has no grant on any table in this schema and does not acquire one. The
form does not offer `admin`, and a `CHECK` refuses it independently.

**No password is collected.** One typed at signup would have to be stored until
approval, and Supabase Auth's admin API takes a plaintext password rather than a
hash we compute — so the only available shapes were plaintext or reversible, for
an account that may never exist. Approval instead mints 144 bits of randomness,
shows it to the approver **once**, and stores only Supabase's hash. Nothing emails
it.

Duplicates are accepted **silently**. Answering "that account already exists"
would turn a public endpoint into an oracle for who works here.

---

## Integrations

| | Status |
|---|---|
| **Shopify Admin API** | Live. Catalogue, images, inventory, orders |
| **WhatsApp** | Built, template-based, with a webhook |
| **Slack** | Built, needs channel configuration |
| **Google Drive** | For intake photographs; not yet wired |
| **EasyEcom** | Verified against the live API, blocked on credentials |

### The Shopify token renews itself

The secret is stored; the token is not. Each run exchanges
`SHOPIFY_API_KEY`/`SHOPIFY_API_SECRET` for a token via the client-credentials
grant, caches it, and re-mints ten minutes before expiry.

This matters because a client-credentials token *looks identical* to the old
permanent `shpat_` token but expires in **24 hours**. Pasting one into an
environment variable produces a deployment that syncs perfectly for one day and
then answers 401 forever, failing a day after whoever configured it stopped
watching. Setting `SHOPIFY_ADMIN_ACCESS_TOKEN` disables the renewal — don't,
unless you genuinely have a permanent token.

### The sync

One bulk operation, not pagination: 10,000 products with a median of eleven
images each is 99 paginated round trips, each able to fail halfway and leave the
catalogue half-updated. Shopify runs the query server-side and returns one JSONL
file.

Runs daily at 01:00 UTC (06:30 Bengaluru) via Vercel Cron, and on demand from
`/admin/settings`. `sync_runs` records every attempt, and every quantity on
screen carries the age of the last **successful** sync — not the last attempt,
which is how a three-day-old number gets presented as live.

**Daily is the plan limit, not a preference.** Vercel Hobby permits one cron run
per day and *rejects the deployment* if the schedule asks for more.

---

## Data model

**16 tables, 4 views.** Highlights:

- **`products`** — the read model. Upserted by the sync; never the system of
  record for anything a human decided. Columns a human owns (`manual_image_url`,
  `crop_json`, `display_image_position`, `crop_mode`, and now `vendor_id` once
  identified) are explicitly excluded from the upsert so a sync cannot undo them.
- **`product_intakes`** — workflow state for new products, deliberately separate
  from `products` for exactly that reason. Joined on `sku`.
- **`master_data`** — attribute vocabularies, keyed `(type, code)`. The sync
  discovers codes from SKU segments; a human names each one once. `BRHM` is in
  the SKU; whether it means "Bridal" or "Brahmin" is not, and cannot be derived.
- **`sku_sales_daily`** — units, orders and revenue per SKU per day.
- **`order_lines` / `order_line_refs`** — a restock line names a SKU; a
  new-design line carries a brief and one to six reference photographs.
- **`product_seq`** — the Unique Code. The v2 catalogue runs 1..15,549 and new
  codes start at 16000, so numbering is continuous across the two systems.

### Images

Every image is imported — the bulk API returns all of them, averaging 11 per
product and reaching 46. The card shows **image 3 by default**, because image 1
is almost always the full-length shot on a model where the saree is a quarter of
the frame, and image 3 is the fabric. Where a product has fewer than three, the
**last** is used rather than the first, since image order runs from context to
detail.

An admin can override per product: pick any image, draw a crop, or paste a URL
from elsewhere.

---

## Operations

```bash
npm run dev              # local
npm run migrate          # apply missing migrations (--dry-run first)
npm run test             # 39 isolation tests against a throwaway Postgres
npm run verify           # i18n + typecheck + lint + test
npm run provision -- --role vendor --name "…" --user-id hdr \
                     --password '…' --vendor-code HDR --locale kn
npm run provision -- --user-id hdr --password '…' --reset-password
```

### Environment

| Variable | Where |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel + local |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel + local |
| `SHOPIFY_SHOP_DOMAIN`, `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET` | Vercel + local |
| `CRON_SECRET` | Vercel + local |
| `DATABASE_URL` | **local only** — scripts, never the app |

Migrations are applied directly to Supabase, not by the deployment. The database
is therefore normally *ahead* of production, never behind it.

---

## Defects found and fixed, 2026-08-19

Recorded because most were silent, and the pattern is worth recognising.

1. **The scheduled sync could never authenticate.** Every sync RPC checked
   `app.is_internal()`, which resolves through `auth.uid()`; the cron runs as the
   service role with no user. It raised on its first write, every time, since the
   day it was written. Fixed with a second principal rather than a wider
   `is_internal()`, which would have touched eleven migrations' policies to solve
   a problem in four functions.

2. **Every synced-in product had a NULL collection.** `sync_upsert_products` never
   wrote `collection`, `fabric` or `colour_code` — they were populated only by the
   CSV seed loader. Since `/reorder`'s access path is vendor-then-collection, every
   product that arrived from Shopify was unreachable through the screen that exists
   to reorder it.

3. **100 "weavers" were stock numbers.** See *The holding pen*.

4. **Six commits never deployed at all.** `vercel.json` carried two independent
   blockers, each hiding behind the other: a half-hourly cron schedule that Hobby
   *rejects the deployment* for (it does not silently downgrade it, which a comment
   in that file claimed), and a `comment` property that `crons[0]` does not permit —
   so the comment explaining the schedule failed the config validator. Both are
   invisible from outside: the git integration was fine the whole time.

5. **The reorder pool excluded the designs most in need of reordering.**
   `qty_available in (0, 1)` cannot match a negative, so the 27 oversold designs —
   one having sold 626 pieces in ninety days — were the only ones the grid could
   not show. Fixed in all nine places the predicate lived: fixing only the query
   would have been worse, because a partial index narrower than the query stops
   being used and the grid falls back to scanning ten thousand rows.

6. **A `'use server'` file exported a constant.** Such a file may export only
   async functions; everything else is rewritten into a server-action reference
   for the client bundle. The signup form imported a function stub and called
   `.map` on it. Typecheck passed, the build passed, and it 500'd on the first
   real request.

---

## Open decisions

These need a person, not a commit.

1. **Who wove the `VINTWB*` sarees.** 100 of them sit in the holding pen. The
   `VINT` collection and the title `VINTWB14514` on a `BGP` product hint at an
   answer, but the sync cannot derive it.
2. **`XX` and `GEN`.** The three commonest discovered codes are `collection GEN`
   (3,991 designs), `fabric XX` (3,899) and `colour XX` (1,572) — a quarter of the
   catalogue carrying "unspecified" in a segment intake will present as a required
   dropdown. `master_data.status = 'ignored'` exists for exactly this; which of the
   three is a real value is a business answer.
3. **Approval notifications.** `/admin/signups` is a queue that pings nobody.
   Slack and WhatsApp both exist in the codebase; neither is wired to this.
4. **EasyEcom credentials.** `POST /access/token` needs email, password and
   `location_key`. Without them nothing EasyEcom-related can be tested.
5. **One stuck sync row.** The cron run of 2026-08-20 01:22 UTC is still marked
   `running` and never finished — a process killed mid-sync, which is exactly the
   state `sync_runs` was designed to make visible. The runs either side of it
   succeeded. Worth watching for a pattern before treating it as a bug.

---

## What is next

The build order continues at **`/admin/master-data`** — naming the 100 discovered
codes, commonest first. It is the last thing standing between here and the intake
form, because every intake dropdown is built from that vocabulary.

After that: `/intake` and `/intake/queue`, then rewiring n8n as a headless job
runner, `/review` for approvals, product corrections written back through
Shopify, Shopify webhooks as a live complement to the daily cron, and the
per-product sales drill-down.
