# Connecting Shopify

**This is the one thing left to do.** Everything downstream of it — the sync,
the image selection, the sales history, the tiered reorder grid, the badges, the
insights dashboard — is written and deployed. It reads zeroes until these two
variables are set, and starts working the moment they are.

Fifteen minutes.

---

## 1. A custom app

In Shopify admin → **Settings → Apps and sales channels → Develop apps**:

1. If it says **Allow custom app development**, press it. Store owner only, and
   it is one-way.
2. **Create an app** → name it `Nerige Portal` → **Create app**.

A custom app rather than a public one: it is installed on exactly this store,
needs no Partner account and no OAuth flow, and its token does not expire.

---

## 2. Scopes

**Configuration → Admin API integration → Configure.** Tick exactly these:

| Scope | Why |
| --- | --- |
| `read_products` | The catalogue: titles, images, prices, variants. |
| `read_inventory` | `inventoryQuantity` on each variant. |
| `read_orders` | Units sold per SKU per day. |

> `read_orders` only reaches **60 days** by default. The sales backfill wants
> 400. On the same Configuration screen, request **`read_all_orders`** — Shopify
> shows a short form asking why, and "internal reporting and demand planning"
> is accurate and is approved automatically for most stores. Without it the
> backfill silently returns 60 days, every design older than that reads as
> "never sold in a year", and the whole reorder grid sorts wrongly while looking
> perfectly healthy.

**Save**.

---

## 3. Install and take the token

**API credentials → Install app → Install.**

Under **Admin API access token**, press **Reveal token once**. It starts
`shpat_`, and *once* is literal — Shopify will not show it again.

```bash
SHOPIFY_SHOP_DOMAIN=nerige-story.myshopify.com
SHOPIFY_ADMIN_ACCESS_TOKEN=shpat_...
```

`SHOPIFY_SHOP_DOMAIN` is the `.myshopify.com` domain, not the customer-facing
one. Find it in **Settings → Domains**, listed as the store's permanent domain.
It is accepted with or without `https://`.

---

## 4. The cron secret

The scheduled sync runs from a public URL, so it has to prove it is the
scheduler:

```bash
openssl rand -hex 32
```

```bash
CRON_SECRET=the-value-you-just-generated
```

Set the same value in the hosting environment. Vercel Cron sends it as
`Authorization: Bearer …` automatically. **If `CRON_SECRET` is unset, the sync
endpoint refuses everything** — a deliberate default, because the alternative is
an open URL that starts Shopify bulk operations.

---

## 5. Run it

Deploy, then **Settings → Shopify → Sync now** on *Products and stock*.

Expect roughly a minute for 9,840 products. When it finishes the panel shows how
many rows were seen and written. Then run *Sales history* — the first run
backfills 400 days and takes longer.

After both, the reorder grid sorts by the tier ladder and the badges have
numbers in them.

---

## 6. The schedule

`vercel.json` already declares it:

```json
{ "crons": [{ "path": "/api/sync", "schedule": "0,30 * * * *" }] }
```

Every thirty minutes, on the hour and the half hour. Products first, then sales
— sales rows have a foreign key onto products, so a design added this morning
has to exist before its orders can be counted.

> **On Vercel Hobby, cron jobs run once a day and the schedule is ignored.**
> Sub-daily crons need Pro. On Hobby, the *Sync now* button still works and is
> the whole mechanism; the age of the last successful sync is shown beside every
> quantity either way, so a stale number is never presented as a live one.

---

## What the sync will and will not do

**It never deletes.** A product Shopify stops returning is marked
`is_active = false` and kept. A disappearance is far more often a filter change
than a saree that ceased to exist, and deleting would break every order line
pointing at it — including one a weaver is halfway through making.

**It never overwrites a manual image override.** `manual_image_url`,
`crop_json`, `display_image_position` and `crop_mode` are what a human chose
after looking at the photograph. A sync every thirty minutes that undid them
would quietly erase an afternoon's work.

**It never filters on `shopify_status`.** Shopify drafts a product the moment it
sells out — 8,182 of the 8,891 designs in the reorder pool are draft. Excluding
them would empty the screen of exactly the sarees that proved they sell. The
isolation suite asserts no policy or function does this.

**It creates vendors it has not seen.** The SKU prefix *is* the vendor, so a new
prefix is a new weaver, created with the code as her name until somebody edits
it. The alternative is dropping her products silently.

**It sets aside damaged stock.** A SKU beginning `DMG` or `SAREE` is damaged
goods sold off cheap, not a weaver. Those rows are skipped and counted in the
sync report.

---

## When it goes wrong

| Symptom | Cause |
| --- | --- |
| "Shopify is not connected" | The two variables are unset in the environment the app is running in. Vercel needs them added *and* a redeploy. |
| 401 from Shopify | Token wrong, or it was copied from a different store. |
| "A bulk operation is already running" | The cron and the button overlapped. Wait a few minutes; one is doing the work. |
| Sync succeeds, sales all zero | `read_all_orders` was not granted. Add it, reinstall, re-run. |
| Sync succeeds, 0 rows written | Every SKU was skipped. The run report names why — usually SKUs with no vendor prefix. |
