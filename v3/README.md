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
| 9 | Five languages, per-vendor, and the tutorial film | Done |
| 10 | Live Shopify sync, image selection, the image editor | Done |
| 11 | The admin panel, vendor accounts, impersonation | Done |
| 12 | Sales history, the tier ladder, card badges | Done |
| 13 | The insights dashboard | Done |
| 14 | Two send channels: dashboard and WhatsApp | Done |
| 15 | Purchase orders, Google Drive, Slack | Done |

**One thing is left, and it is not code.** Set `SHOPIFY_SHOP_DOMAIN` and
`SHOPIFY_ADMIN_ACCESS_TOKEN` and press *Sync now* in Settings — the catalogue,
the stock, the photographs, the sales history, the tier ladder, the badges and
the whole insights dashboard fill in from that one step. Everything downstream
of it is written and deployed and reads zeroes until it happens. See
[docs/shopify-setup.md](./docs/shopify-setup.md).

## Commands

```bash
npm run dev           # development server
npm run seed          # load the CSVs into DATABASE_URL
npm run seed:verify   # boot a throwaway Postgres, migrate, load, reconcile counts
npm run seed:order    # create one order so the vendor screen has something to show
npm run preview:order       # render the order screen to a static HTML file
npm run preview:catalogue   # same, for the catalogue
npm run provision     # create a login
npm run i18n:check    # every locale file carries every English key
npm run verify        # i18n:check + typecheck + lint + tests
```

`npm run i18n:check` also runs before `npm run build`, so a phase that adds a
string to `en.json` and forgets the other four cannot deploy.

## Setup

```bash
cp .env.example .env.local          # then fill in the Supabase values
npm install
```

Point it at a Supabase project — `npm run setup` does all of it in one pass
(migrations, catalogue, both logins, one demo order) and prints the two
passwords it generated. Or, by hand:

1. Apply `supabase/migrations/*.sql` in filename order (SQL editor, or
   `supabase db push` if you use the CLI).
2. Load the catalogue: `npm run seed`, with `DATABASE_URL` set to the project's
   session-mode connection string.
3. Create the two logins:

```bash
npm run provision -- --role procurement_head --name "Pooja" \
  --user-id pooja@nerigestory.com --password '<generated>'

npm run provision -- --role vendor --name "HDR owner" \
  --user-id hdr --password '<generated>' --vendor-code HDR --locale kn
```

There is no third step. Password sign-in needs no auth provider, no SMS
gateway, no redirect allow-list and no OAuth client — which is most of why it
is what this build uses.

In Supabase, turn **off** *Authentication → Providers → Email → allow new users
to sign up*. Nothing in this codebase calls `signUp`, but the anon key is public
by definition, and leaving signup enabled means anyone holding it can POST to
`/auth/v1/signup` directly. Such an account sees nothing — every policy resolves
through `app_users` and it has no row there — but it should not exist at all.

### Sign-in

A **user ID** and a **password**, issued by the Nerige team. Nobody signs
themselves up and nothing is emailed.

The user ID is an email address for the Nerige team, and a short handle like
`hdr` for a weaver — she has no work address, and requiring one would mean
telling her to go and get an email account before she can read her order.
Handles map to a derived address on a domain that cannot receive mail
(`src/lib/auth/user-id.ts`), because nothing is ever sent to them.

`signInWithPassword` cannot create an account. That is the reason it is the
entire auth surface: `signInWithOtp` creates one by default, and
`signInWithOAuth` has no way to be told not to. The only code path that mints a
user now is `scripts/provision-user.ts`, which runs from a laptop with the
service-role key. A wrong ID and a wrong password return the same message, so
the form is not a directory of who works here.

Changing a password:

```bash
npm run provision -- --user-id hdr --password '<new>' --reset-password
```

## Data

Two sources, neither sufficient alone. The join key is the SKU string.

| Field | Source |
| --- | --- |
| Quantity available | Shopify today, EasyEcom `Available` later |
| Image, description, title, price | Shopify |
| Units sold per day | Shopify orders |
| Vendor identity | SKU prefix, derived |

The CSV loader in `src/lib/seed/load.ts` is still here and still works, but it
is no longer the source of truth. `products` is refreshed every thirty minutes
from Shopify's Admin GraphQL API through `bulkOperationRunQuery` — 9,840
products with a median of eleven images each is 99 paginated REST round trips
that can rate-limit halfway through and leave the catalogue half-written. A bulk
query is one request, one poll loop and one download, and it cannot half-finish.

Three rules the sync keeps, each of which is a way it could quietly do damage:

- **It never deletes.** A product Shopify stops returning is marked
  `is_active = false`. A disappearance is far more often a filter change than a
  saree that ceased to exist, and deleting would break every order line pointing
  at it — including one a weaver is halfway through making.
- **It never overwrites a manual image override.** `manual_image_url`,
  `crop_json`, `display_image_position` and `crop_mode` are what a human chose
  after looking at the photograph. A sync every half hour that undid them would
  erase an afternoon's work invisibly.
- **It never filters on `shopify_status`.** Unchanged, and still the single most
  important rule in this codebase.

`sync_runs` records every attempt, successful or not, and every screen showing a
quantity shows the age of the last **successful** one. Those are the same number
until the day they are not — and that day is exactly when a job failing every
half hour would otherwise report a healthy sync over three-day-old stock.

### Which photograph a weaver sees

Shopify returns a median of eleven images per product. Image 1 is, on
essentially every product in this catalogue, the full-length shot on a model —
the saree occupies about a quarter of the frame and the rest is face, background
and floor. Image 3 is the fabric.

So the default is position 3, stored per product so it can be corrected, with a
fallback to the **last** available image where a product has fewer than three
(about 169 of them: their order runs context to detail, so the last is the
closest thing to a fabric shot they have; the first would be the model again).

The resolution order is written once in `resolveProductImage()`: a manual URL,
then the image at the stored position, then the CSV-era column. The admin can
override any of it from `/admin/products` — pick a different Shopify image, drag
a crop rectangle, or paste a URL — and the crop is stored as fractions of the
source so it survives the image being served at a different size.

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

It opens on all of them, newest first, and narrows by **collection, colour or
fabric** — the three things the SKU actually encodes. HDR has 2,365 designs
across 19 collections, 81 colours and 11 fabrics, and the filter options carry
their counts (`GRN (465)`) so she knows a filter is worth applying before she
applies it. Only values she actually has appear; a dropdown offering colours she
has never woven is worse than no dropdown.

This screen used to refuse to render anything until a collection was chosen, on
the reasoning that 2,365 designs is not a grid anyone browses. That was the
wrong trade. A weaver looking for a saree she half-remembers does not know which
collection it was filed under, and being made to guess before seeing anything
reads as an empty portal. Pagination handles the volume; the filters handle the
finding.

Every filter lands in the URL, so a result is a link she can send to someone.

The options come from `vendor_facets`, one `security_invoker` view over
`products`, because PostgREST cannot express GROUP BY over a table and three
separate views would be three grants to keep in step.

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

### Sorting, and the ladder

The default is no longer a single column. It is four rungs, and within a rung,
units sold in the chosen window descending:

| Rung | Meaning | Badge |
| --- | --- | --- |
| 1 | Sold within the selected window | Selling |
| 2 | Sold within 365 days, but not the window | Slowing |
| 3 | Unsold in a year, but stock remains | In stock, not moving |
| 4 | Unsold in a year, no stock | Dormant |

A selector at the top chooses the window — 30, 60 or 90 days, defaulting to 90 —
and changing it re-sorts the grid and changes the badge text.

**This is what the whole sales pipeline is for.** Before it, a saree that sold
out yesterday and one that had not moved since 2024 were indistinguishable on
this screen: both read `qty_available: 0`, and both looked like proof of demand.
Only one of them is. Anything unsold for a year now sits at the very bottom.

PostgREST cannot put a CASE in an ORDER BY and a view could not take the window
as a parameter, so the rung is computed during the sales rollup and stored as
`tier_30`, `tier_60`, `tier_90`. The entire sort becomes
`order by tier_90, units_90d desc`, which one partial index covers.

`sku_sales_daily` holds units, distinct orders and revenue per design per day,
backfilled 400 days from the Shopify orders API and then incremental. Daily
grain rather than a running total because every window is a question somebody
will ask later; a stored 90-day counter answers exactly one and has to be
rebuilt from scratch the first time anyone wants a different number.

400 rather than 365 because the windows are measured backwards from today — a
straight year would leave the oldest end empty for the first five weeks after
go-live, and "not sold in a year" would be wrong for exactly the designs it
matters most about.

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

### Sending, and what "sent" means

An order can be delivered twice, so delivery is recorded per channel.
`dashboard_sent_at` is set at issue, because putting an order in her portal *is*
delivering it there. `whatsapp_sent_at` is only ever set by a successful send.

That split exists because "sent" was one fact while the portal was the only way
to reach her, and stopped being one the moment WhatsApp existed alongside it. A
weaver who never opens the portal and reads everything on WhatsApp, and one
whose WhatsApp is on a phone that is not hers, are different people with the
same order.

`whatsapp_status` then tracks what Meta reports through the webhook — sent,
delivered, read, failed — and the screen shows those as different words on
purpose. WhatsApp **accepting** a message means it left us; only `delivered`
means it arrived. A wrong number accepts the send and fails quietly some minutes
later, and collapsing the two is how somebody concludes a weaver has seen an
order she never got.

A WhatsApp send is two stages and cannot be otherwise: one Meta-approved
template message, which is the only thing allowed to arrive unsolicited and
which opens a 24-hour window, then the per-line photographs as free-form
messages inside it. The template text to submit is in
[docs/whatsapp-template.md](./docs/whatsapp-template.md); until it is approved,
every send fails with error 132001 and the portal says exactly that.

### Purchase orders

`Generate PO` allocates a number from a sequence and stores it — regenerating
produces the same number, because an identifier that changes when a document is
reprinted is not an identifier. The PDF is built with `pdf-lib` rather than
headless Chrome: a browser is a 50MB layer and a multi-second cold start for a
one-page document.

Then `Upload to Drive`, then `Send to Slack`. Three actions rather than one
button because each fails for a different reason and the fix differs — a PDF
that failed to build is a bug, a Drive upload that failed is nearly always the
folder not being shared with the service account, and a Slack post that failed
is nearly always the bot not being in the channel. One button reports all three
as "could not send the PO".

Setup for each: [Drive](./docs/google-drive-setup.md), [Slack](./docs/slack-setup.md).

## The admin panel

Fixed to the left, on every screen Pooja can reach rather than only inside a
settings area — she moves between reordering, orders, vendors and insights in
one sitting, and a hub she has to return to between each is a tap she pays every
time. My profile, my vendors, insights, settings.

**Creating a vendor** makes the vendor row, the auth user, the profile and the
link, and shows the generated password once, with a copy button and a print
button that prints the credential alone.

**The password is never stored.** It is generated in memory, handed to Supabase
Auth — which keeps only a bcrypt hash — rendered once into the response that
created it, and then it is gone. Nothing writes it to a table, a log line or a
cookie. What *is* stored is `credential_issued_at` and `credential_issued_by`,
which answers every question an admin actually has about a credential except the
one nobody at Nerige should be able to answer. Lost passwords are re-issued, one
click, and that is itself recorded.

Reversible encryption was the alternative and is worse than useless here: a key
the application can decrypt with is a key an attacker who reaches the
application can decrypt with, so it converts "passwords are safe" into
"passwords are as safe as one environment variable" while looking prudent.

The alphabet excludes `O`, `0`, `l`, `I`, `1`, `S` and `5`, and groups in fours
— these get read aloud down a phone line, in a noisy room, by someone reading
Latin script as a second script.

**Impersonation** serves the real vendor routes with the vendor identity
swapped, so it is her screen rather than a second rendering of the same data
that can drift. Read-only, enforced in the action layer because the database
genuinely permits those writes for an admin and cannot tell which hat she is
wearing — and every session is logged with who, whom and when, which is the
compensating control for a capability RLS cannot scope.

## Insights

Admin only, and never visible to a weaver — the route is behind
`requireProcurement()` *and* every function it calls is `security invoker`, so a
vendor login that somehow reached the RPCs directly would see her own rows and
nobody else's.

A date range with presets, then four stacked multi-select filters — vendor,
collection, fabric, colour — each narrowing the next, and each drawn from the
tokens already parsed onto `products`. The narrowing is real: choosing HDR means
the collection list shows only collections HDR has. A dropdown offering a
combination with nothing behind it produces an empty dashboard with no
explanation for it.

Then orders placed, units sold, distinct designs sold, sell-through and revenue;
a table of the same figures one level down, where each row links to itself so
reading and drilling in are the same gesture; a line chart; and a CSV export
that re-runs the query rather than serialising the rows on screen — the day
somebody paginates that table, a client-side export would quietly write one page
and still be called "Export CSV".

Sell-through is units sold ÷ (units sold + units still on hand). "Units
available in period" has no single honest reading because stock moves during the
window; this is what was actually shifted over everything that could have been,
which is what a buyer means, and it cannot exceed 1.

Read only apart from cancel, and that is a database rule rather than a hidden
button. `app.orders_internal_write_guard()` refuses every status move except
issued-or-accepted to cancelled, and refuses any edit to the promised date, the
dispatch date or the docket — those are the weaver's to set, and overwriting
them from this side is how two people end up arguing from two differently worded
copies of the same order.

## Isolation

RLS is enabled **and forced** on `products`, `orders`, `order_lines` and
`order_line_refs`, so policies apply even to the table owner.

Every policy compares against a scalar sub-select — `vendor_id = (select
app.current_vendor_id())` — rather than calling a helper that takes the row's
own column. That is not style. A function taking `vendor_id` as an argument
cannot be hoisted, so it runs once per row, and each run joins `vendor_users` to
`app_users`. Measured on the real project as the HDR weaver, before the fix:
`count(*)` on `products` took **7.0 s**, a page of the catalogue **6.0 s**, and
`vendor_facets` **17.8 s** — past Supabase's 8-second statement timeout, so it
did not merely crawl, it failed. As an InitPlan the same three take **3.6 ms**,
**3.9 ms** and **10.2 ms**. Correct and unusable is still unusable. Policies resolve
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
  `vendor_users`, and the `vendor_collections` and `vendor_facets` views
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
messages/                 One JSON file per language. en.json is the contract.
docs/                     Connection guides: Shopify, WhatsApp, Drive, Slack
src/app/login/            User ID and password, for everybody
src/app/(app)/            Everything behind a session
src/app/(app)/admin/      Pooja's panel: profile, vendors, products, insights, settings
src/app/api/              Cron sync, WhatsApp webhook, PO download, CSV export
src/components/ui/        Primitives, phone-first, 44px touch targets
src/i18n/request.ts       next-intl, locale from the session and not the URL
src/lib/auth/             Session resolution, role guards, impersonation, passwords
src/lib/i18n/             Locale resolution, number formatting, the dictionaries
src/lib/insights/         model.ts is shared with the client; query.ts is server-only
src/lib/integrations/     WhatsApp, Google Drive, Slack
src/lib/po/               The purchase order PDF
src/lib/products/image.ts Which photograph, and how it is cropped. One file.
src/lib/seed/             The CSV loader — a fallback path now, not the source
src/lib/shopify/          Bulk operations, product sync, sales sync
src/lib/supabase/         server (RLS-bound) · admin (service role, three uses)
src/proxy.ts              Session refresh and the signed-out redirect
supabase/migrations/      Schema and RLS
supabase/tests/           Supabase shim, so the suite runs on vanilla Postgres
tests/harness/            Real Postgres, real migrations, real role switching
```

## The service-role key

`.env.example` used to say this key was local-only and must never be set in a
deployment. That has changed, and it is worth understanding rather than
copying: the admin panel creates vendor logins, and creating an `auth.users` row
is not expressible under RLS — no policy of ours reaches Supabase's own auth
schema.

Three code paths hold it and no others:

- creating and re-issuing a vendor login, behind `requireProcurement()`
- the scheduled sync route, which has no session to run as
- the WhatsApp delivery webhook, which has no session either

Everything else — every screen, every query, every other action — runs as the
signed-in user under RLS. The sync itself goes through two `SECURITY DEFINER`
RPCs that check `app.is_internal()` inside the function rather than relying on a
grant, so the bypass is as narrow as it can be made.

## Language

Five, complete: English, Kannada, Telugu, Tamil and Hindi. One JSON file each in
`messages/`, read through next-intl. There is no locale in the URL and nothing
for a weaver to pick — she signs in and the portal is in her language.

**Language belongs to the weaver, not to a login.** `vendors.default_locale` is
the fact: the Gadwal house is Telugu speaking, so PGW is set to `te` and her
portal is Telugu from her first sign-in, before she has found a setting.
`app_users.locale_override` is the exception, hers to change from a picker in
her own header, and it applies to that login alone — so the owner's son who
reads Kannada does not move the whole house. Resolution is override, then vendor
default, then English, written down once in `resolveLocale()`.

`npm run i18n:check` fails the build if any locale is missing a key English has,
carries a key English does not, or drops a `{placeholder}` — that last one still
renders, which is exactly why it needs checking. It runs before every build.

**What is never translated**: SKU codes, saree names, vendor codes, collection
tokens. Those are Latin-script identifiers matched against EasyEcom and copied
onto a fabric label by hand; a transliterated code matches nothing.

Digits stay Latin. `LOCALE_CONFIG` carries `useNativeNumerals`, false for all
five, and every number on every screen renders through `formatCount()` — so
reversing that judgement for one language is one boolean and no component
changes. Kannada and Devanagari digit forms exist and are correct; they are
simply not what a quantity read aloud to a transporter is for.

**These translations still want a native speaker's eye.** They are complete and
careful, not authoritative — and a mistranslated instruction on the screen where
someone copies a code onto fabric reads as authoritative whether or not it is.

## The tutorial film

A card at the top of `/portal`, above her orders, on every visit and not
dismissable. A weaver may have used this portal twice, three months apart, on a
shared phone; a "don't show again" checkbox gets pressed once by someone who has
understood nothing yet.

`tutorial_videos` holds one active row per language, chosen by her resolved
locale with English as the fallback, managed from Settings. The film plays
inline — sending her to YouTube means sending her into an app that will
recommend her something else and not bring her back — with a translated
numbered list of the process underneath, for reading at the loom with the sound
off.

**Use an unlisted video, not a private one.** Unlisted plays for anyone with the
link. Private plays only for YouTube accounts it has been shared with, and a
weaver is not signed in to YouTube here — so a private video shows her "Video
unavailable" while playing perfectly for the admin who uploaded it. That cannot
be detected from a URL, so the Settings screen states it and previews the embed
a weaver would actually get.
