# Nerige — vendor portal

A phone-first portal with two kinds of user.

**Pooja** browses sarees that have sold out or are down to the last piece, one
weaver at a time, as a grid of photographs. She taps the ones she wants made
again, taps a few more and says "make me more in this direction", and presses
send once. The system splits her taps by vendor and issues one order per vendor.

**The vendor** opens the portal on a phone, sees only her own sarees, sees the
picture, the description and the code large, accepts the order, and writes those
codes on the pieces before packing.

That is the whole product.

Next.js 16 (App Router) · TypeScript · Tailwind 4 · Supabase (Postgres + Auth + RLS)

---

## The two ideas everything rests on

**A SKU is a design, not a piece.** `PGW-BRHM-SLK-CRM-5855` is a cream Gadwal
silk. Nerige may have owned four of them over two years. The SKU is what the
vendor writes on the piece; the serial number is what the warehouse writes, in
EasyEcom. `products.sku` is the primary key for that reason.

**Sold out means it sold.** Shopify flips a product to `draft` the moment stock
hits zero — 8,338 of the seeded designs are draft. A saree at zero stock is not
dead, it is proof of demand, and a weaver can make it again from the
photograph. Nothing in this codebase filters the reorder pool on
`shopify_status`.

**The SKU prefix is the vendor.** `PGW` is Pranav Gadwal, `HDR` is HDR. Vendor
isolation derives from the SKU string; there is deliberately no product-to-vendor
mapping table.

---

## Build order

| Step | Scope | State |
| --- | --- | --- |
| 1 | Scaffold, migrations, the four tables, RLS forced | Done |
| 2 | Seed loader for the two CSVs in `v2/` | Done |
| 3 | Auth and the two roles | Done |
| 4 | `/portal/orders/[id]` — the vendor order screen | Done |
| 5 | `/portal` and `/portal/catalogue` | Done |
| 6 | `/reorder` — the photo grid and the review step | Done |
| 7 | `/orders` and `/orders/[id]` | Done |
| 8 | The isolation suite | Done |

## Commands

```bash
npm run dev           # development server
npm run seed          # load the CSVs into DATABASE_URL
npm run seed:verify   # boot a throwaway Postgres, migrate, load, reconcile counts
npm run seed:order    # create one order so the vendor screen has something to show
npm run preview:order       # render the order screen to a static HTML file
npm run preview:catalogue   # same, for the catalogue
npm run provision     # create a login
npm run verify        # typecheck + lint + tests
```

## Setup

```bash
cp .env.example .env.local          # then fill in the Supabase values
npm install
```

Point it at a Supabase project:

1. Apply `supabase/migrations/*.sql` in filename order (SQL editor, or
   `supabase db push` if you use the CLI).
2. Load the catalogue: `npm run seed`, with `DATABASE_URL` set to the project's
   session-mode connection string.
3. Turn on phone auth — Supabase → Authentication → Providers → Phone, with an
   SMS provider configured. Without one, vendor sign-in silently does nothing.
   Email magic links need no extra provider.
4. Add `${NEXT_PUBLIC_APP_URL}/auth/callback` to the Auth redirect allow-list,
   or Pooja's link lands on an error page.
5. Create the two logins:

```bash
npm run provision -- --role procurement_head --name "Pooja" --email pooja@nerigestory.com
npm run provision -- --role vendor --name "HDR owner" --phone 9876543210 --vendor-code HDR --locale kn
```

Nobody can sign themselves in. `signInWithOtp` runs with
`shouldCreateUser: false`, so an unrecognised number gets the same reply as a
recognised one and no account is created either way.

## Data

Two sources, neither sufficient alone. The join key is the SKU string.

| Field | Source |
| --- | --- |
| Quantity available | EasyEcom |
| Image, description, title, price | Shopify |
| Vendor identity | SKU prefix, derived |

EasyEcom holds no images. Shopify holds no trustworthy warehouse stock. This
portal is the only place the two meet, and that is its reason to exist.

The build runs against the two seed CSVs in `v2/`, behind a loader
(`src/lib/seed/load.ts`). That loader is the seam: wiring the EasyEcom inventory
endpoint later changes it and nothing else. Every screen reads `products`.

`stock_synced_at` is stored per SKU and every quantity shown on screen carries
its sync age, because a stale number presented as live is worse than no number.

The reorder pool is not a table. It is the predicate `qty_available in (0, 1)`,
defined once in `reorderReason()` and proven on every load to reproduce the
supplied pool file exactly.

The loader refuses to guess. A SKU that appears twice stops the load outright,
because either row could be the real saree. `DMG` marks damage rather than a
weaver — the same marker appears mid-SKU on real vendors, as in
`HDR-PUR-DMG-49` — so where it leads a SKU the row is set aside instead of
becoming a vendor. Everything set aside is named in the load report.

## The vendor order screen

`/portal/orders/[id]` is the screen this build is judged on. Two headed
sections, restock first, then new designs, as a vertical scroll of cards. One
card fills most of a phone screen.

A restock card is a photograph, then the code, then the words. The code sits
directly under the picture in 19px monospace and wraps rather than truncating,
because it is copied onto a fabric label by hand and has to be readable at arm's
length. There is no table anywhere on this screen — a table puts that code in a
cell that clips.

A new-design card leads with Pooja's note, carries a sideways strip of one to
six reference photographs, and says **"no code, we will label this on arrival"**
where a restock card shows a code. That sentence is the point of the card: it
tells the weaver not to go looking for one.

Everything on the card comes from the snapshot columns on the line, never from
the live product row. A re-shoot next month must not change the photograph on an
order she has already accepted.

At the bottom, one decision. An issued order asks when the pieces will be ready
and offers one button; the dispatch fields do not appear until she has answered.
That is all a vendor can write, and it is the database that says so — see
`app.orders_vendor_write_guard()`.

`npm run preview:order` renders this screen to a static HTML file from real
seeded data, without needing a Supabase project to look at it in.

## The rest of the portal

`/portal` is her orders grouped by what needs her — to accept, in progress,
sent — and nothing else. Empty groups render nothing at all, because a screen of
empty headings reads as broken.

`/portal/catalogue` is every design Nerige holds for her, in the same card.
Collection is a choice rather than a default, for the same reason vendor is
required on Pooja's grid: HDR alone has 2,365 designs across 19 collections and
no phone renders that. With nothing chosen the screen shows the collections
themselves — one tap, then the cards. Search cuts across all of them, because a
weaver looking up one code does not know which collection it was filed under.

Print hides the navigation, the search box and the pagination, and no card
splits across a sheet.

### Sync age

Every quantity in this build renders through `<StockLine>`, which prints the
number and how old it is: **"1 in stock · checked about 1 hour ago"**. That is
the only way the rule survives contact with the next screen someone adds.
`qty_available` is only ever as fresh as the last sync, and a number presented
as live when it is three days old sends a weaver to make something we still
have twelve of.

## The reorder grid

`/reorder` is a grid of photographs, not a list. It should feel like browsing
the storefront, except tapping means "make this again" — so the tile is the
photograph, the code sits under it small enough not to compete, and the
description lives behind an info button rather than on the tile.

Nothing renders until a vendor is chosen. That is the design, not a loading
state: 8,891 designs is not a grid anyone can browse, and the work happens one
weaver at a time. Narrowing is vendor first, then collection; 110 of the 115
vendor-collection pairs are under 500 tiles, and pagination covers the five that
are not — HDR/VINT alone is 1,660.

The footer splits the selection live, `14 selected · HDR 6 · PGW 5 · SMT 3`,
because Pooja is making one decision and needs to see that it lands as three
orders before she presses send. Selection lives in `sessionStorage` via
`useSyncExternalStore`, so it survives changing weaver, paging and walking to
the review step.

The review step is where a line stops being "make this again" and becomes "make
me more in this direction" — a different line, a different card on the weaver's
phone, and a saree that comes back with no code on it.

### Sorting

`src/lib/reorder/sort.ts` is a registry of named strategies, and it is one file
on purpose. `sales_rank` is nullable and empty until the EasyEcom SKU
Performance export lands; `fastest_selling` is already written there with
`enabled: false`. Turning it on is one boolean — no new component, no change to
the page.

### The rule that matters

Nothing filters the pool on `shopify_status`. Shopify drafts a product the
moment it sells out, which is 8,182 of the 8,891 designs in the pool — excluding
them would empty the screen of exactly the sarees that proved they sell.

## Pooja's orders

`/orders` groups by the press of send that created them, because that is the
unit she decided in: she tapped fourteen sarees once, and three weavers each got
an order. A flat list would show three unrelated rows and hide the decision.

`/orders/[id]` renders the weaver's screen — literally the same `OrderSections`
component, from the same `ORDER_SELECT`. If Pooja wants to know what the vendor
is looking at, she should be looking at it, not at a table claiming to describe
it. Above it sit the four facts she opens the screen for: when it went, the date
the weaver promised, when it was dispatched, and the docket.

Read only apart from cancel, and that is a database rule rather than a hidden
button. `app.orders_internal_write_guard()` refuses every status move except
issued-or-accepted to cancelled, and refuses any edit to the promised date, the
dispatch date or the docket — those are the weaver's to set, and overwriting
them from this side is how two people end up arguing from two differently worded
copies of the same order.

## Isolation

RLS is enabled **and forced** on `products`, `orders`, `order_lines` and
`order_line_refs`, so policies apply even to the table owner. Policies resolve
identity through `SECURITY DEFINER` helpers in a private `app` schema with
`search_path` pinned; a missing `WHERE` clause in a page cannot leak data.

`order_lines` and `order_line_refs` carry no `vendor_id` of their own — they are
scoped through the parent order in the policy, never in application code.

### The suite

`npm test` boots a real Postgres (no Docker, no network), applies every
migration and runs 36 assertions in under a second. It is not a mock: RLS,
`SECURITY DEFINER` search-path pinning, deferred constraint triggers and
`security_invoker` views have no meaningful mock, and a test double would verify
our assumptions about Postgres rather than Postgres itself.

Everything runs as the `authenticated` role. A superuser bypasses RLS
unconditionally even with FORCE set, so a suite that forgot to switch roles
would pass while production leaked.

**Nothing is listed by hand.** `tests/harness/discovery.ts` asks the catalog
which relations are vendor-scoped and how ownership of one of their rows is
decided:

- relations carrying `vendor_id` directly — `products`, `orders`,
  `vendor_users`, and the `vendor_collections` view
- relations carrying none, found by walking **NOT NULL** foreign keys out of an
  already-scoped relation, with the ownership predicate built by nesting the
  parent's. That is how `order_lines` and `order_line_refs` are covered, and it
  is the case a hand-written list gets wrong first.

Nullable foreign keys are deliberately not followed. `order_lines.sku` is null
on every new-design line, so walking it would produce a predicate that quietly
matched none of them — a suite that believed it had checked.

It also asserts the things that are silent when wrong: RLS forced rather than
merely enabled, `search_path` pinned on every `SECURITY DEFINER` function, every
view declared `security_invoker`, `anon` holding no privilege anywhere, the
isolation helpers unreachable as PostgREST RPCs, a suspended user cut off within
the same request, and no policy or function anywhere filtering on
`shopify_status`.

Sabotaging `products_select_own` to drop its vendor check makes six tests fail
and names the leak:

```
products leaked 3 row(s) via products.vendor_id = $1
vendor_collections leaked 1 row(s) via vendor_collections.vendor_id = $1
```

The view is caught with no extra code, because discovery found it.

## Layout

```
src/app/login/            Phone OTP for weavers, email magic link for Pooja
src/app/(app)/            Everything behind a session
src/components/ui/        Primitives, phone-first, 44px touch targets
src/lib/auth/             Session resolution, role guards, phone normalisation
src/lib/i18n/             Vendor-facing strings, keyed on app_users.locale
src/lib/seed/             The loader — CSV today, EasyEcom later
src/lib/supabase/         server (RLS-bound) · admin (service role, provisioning only)
src/proxy.ts              Session refresh and the signed-out redirect
supabase/migrations/      Schema and RLS
supabase/tests/           Supabase shim, so the suite runs on vanilla Postgres
tests/harness/            Real Postgres, real migrations, real role switching
```

## Language

Every vendor-facing string goes through `src/lib/i18n`, keyed on
`app_users.locale` — English, Kannada, Tamil, Telugu and Hindi. There is no
locale in the URL and nothing for a weaver to pick: she signs in and the portal
is in her language.

`en.ts` is complete and defines the type. The other four are empty and fall
through to English key by key, so a partial translation is useful the day its
first string lands. **They need a native speaker, not a machine** — a
mistranslated instruction on the screen where someone copies a code onto fabric
reads as authoritative and is not.
