# Nerige Story — Procurement OS

The system of record for everything between *"we need stock"* and *"the vendor has been paid."*

Next.js 16 (App Router) · TypeScript · Tailwind 4 · Supabase (Postgres + Auth + Storage + RLS) · n8n · Vercel

---

## The loop this closes

Three people, one weekly cycle, currently held together by a video call and a
WhatsApp thread.

**Pooja (Procurement Head)** decides what to restock and what new designs to
commission, and today has no way to answer *"what did we order, from whom, at
what price, and where is it?"* without scrolling a chat.

**The warehouse manager** receives parcels that frequently arrive with no codes
on them, and has to open every piece to work out what it is before it can be
inwarded.

**The vendor** has to ask what the codes are, ask what is wanted this week, and
then send a paper bill that disappears into a phone gallery.

The system is built around exactly that loop:

```
Pooja builds an order          →  vendor sees it, accepts, commits to a date
  restock lines (known SKU)       and knows the codes to print on every piece
  new-design lines (a brief)
                               →  vendor dispatches, records transporter + docket
warehouse counts it in         →  count is posted; short and damaged recorded
                                  separately, and the vendor can see the count
vendor (or Pooja) uploads      →  three-way match: ordered vs received vs billed
  the hard copy of the bill       Founder approves; payment closes the order
```

## Status

| Milestone | Scope | State |
| --- | --- | --- |
| M0 | Warehouse & ERP spike — no code, see [docs/M0-warehouse-erp-spike.md](docs/M0-warehouse-erp-spike.md) | Ready to run |
| **M1** | **Identity, vendor master, KYC, audit, outbox, RLS** | **Done** |
| **M2** | **Catalogue — design series and the SKU codes vendors label with** | **Done** |
| **M3** | **Purchase orders — restock lines and new-design briefs** | **Done** |
| **M4** | **Vendor portal — accept, dispatch, codes, bill upload** | **Done** |
| **M5** | **Goods receipt — count in, short/damage, immutable once posted** | **Done** |
| **M6** | **Bills — hard copy attached, three-way match, Founder approval, MSME ageing** | **Done** |
| M7 | Analytics & vendor scorecards | Columns in place, unpopulated |
| M8 | Shopify sell-through sync + restock suggestions | Columns in place, sync not wired |
| M9 | Sampling workflow | Not started |

Start at [docs/SETUP.md](docs/SETUP.md).

---

## What each person sees

| | Procurement Head / Founder | Warehouse Manager | Vendor |
| --- | --- | --- | --- |
| Lands on | `/dashboard` | `/inbound` | `/portal` |
| Answers | What needs me today | What is arriving, what needs counting | What do you want, and what codes do I write |
| Can do | Build and issue orders, maintain the catalogue, review bills; the Founder alone approves payment | Count stock in, name a new design's SKU while holding the piece | Accept an order, commit a date, record dispatch, upload a bill, read their own codes |
| Cannot see | — | Bills, audit trail | Draft orders, internal notes, any other vendor |

The Founder-only rule on bill approval is enforced by a database trigger, not by
hiding a button.

---

## Architecture in five points

**1. Shopify is the commercial SKU master; the ERP owns inventory. We are neither.**
This system owns procurement — vendors, purchase orders, settlement, performance. It mirrors products read-mostly and posts to the ERP. There is no second inventory master, because two masters means permanent reconciliation.

**2. Vendor isolation is enforced by the database, not the application.**
Every vendor-visible table carries `vendor_id`; RLS is enabled *and forced* on all of them; policies resolve identity through `SECURITY DEFINER` helpers in a private `app` schema with `search_path` pinned. A missing `WHERE` clause in application code cannot leak data. Supabase Storage has its own path-prefix policies, because locking the metadata table while leaving the bucket open is the most common failure in Supabase projects.

**3. State lives in Postgres. n8n performs effects only.**
Business state transitions are database-enforced. Notifications go through a transactional outbox (`events`) written in the same transaction as the change that caused them — so a notification is never lost and, with an idempotency key, never doubled. n8n drains it. n8n never decides anything.

**4. The audit trail is trigger-driven and append-only.**
Application-level audit logging is always correct except on the one code path someone forgot — invariably the one under dispute. `UPDATE` and `DELETE` on `audit_log` are blocked at trigger level, including for the table owner. Bank account numbers are redacted on the way in.

**5. Goods receipt is a deferred decision, not a blocker.**
`goods_receipts` is designed for two possible writers — our own receiving UI or an ERP ingestion adapter — distinguished by a `source` enum. Everything downstream reads one table. The M0 spike changes an adapter, not the architecture.

**6. An order line is one of two genuinely different things.**
A `restock` line names a SKU the vendor has made before. A `new_design` line carries only the brief given on the call — "teal body, gold temple border, six colour combinations" — because the saree does not exist yet and inventing a SKU for it at order time creates a code that must later be reconciled with whatever actually arrived. The code is assigned at goods receipt, by whoever is holding the piece. This is the one modelling decision the whole weekly cycle turns on.

**7. Money moves only against evidence.**
`vendor_bills.purchase_order_id` and `vendor_bills.document_id` are both `NOT NULL`. A bill with no order is the unattributable spend the business is trying to eliminate; a bill with no photograph of the hard copy is a claim rather than a record. The three-way match — ordered, received, billed — is computed and stored, and frozen at approval so a later correcting receipt cannot retroactively change what the Founder authorised.

---

## Commands

```bash
npm run dev              # development server
npm run verify           # typecheck + lint + full test suite
npm run test:isolation   # vendor isolation suite only
npm run provision -- --role founder --name "..." --email "..."
```

## Tests

`npm test` boots a real Postgres (no Docker, no network), applies every migration, and runs 96 assertions. It is not a mock — RLS, `SECURITY DEFINER` search-path pinning, CHECK constraints and triggers have no meaningful mock.

The isolation suite discovers every table carrying a `vendor_id` **from the system catalog** and asserts a vendor session can see none of another vendor's rows. Tables added in M3–M9 are covered the moment they exist; nobody has to remember to extend the file.

It also asserts things that are easy to get wrong and silent when wrong:

- RLS is *forced*, not merely enabled, on every table
- every `SECURITY DEFINER` function pins `search_path`
- `anon` holds no privilege anywhere
- a suspended user loses access within the same request
- a vendor cannot promote themselves, reactivate themselves, or grant themselves another vendor

`tests/workflow.test.ts` walks the weekly cycle end to end with three different
signed-in users, and asserts the refusals that matter:

- a draft order is invisible to the vendor — header *and* lines
- a vendor's attempt to rewrite the price, quantity or instructions on the order they were sent is pinned back, while their acknowledgement still goes through
- the warehouse can record a receipt and nothing else — not issue, not cancel, and they cannot see bills at all
- a posted count is immutable; corrections are made by posting another
- Procurement can review a bill, but only the Founder can approve or settle it
- a bill cannot skip review, cannot be attached to another vendor's document, and cannot reuse a bill number

## India statutory handling

GSTIN checksums are verified (not just format-matched), the PAN embedded in a GSTIN is cross-checked, and **MSME payment terms are capped at 45 days in the database** — under Income Tax Act s.43B(h), paying a micro or small supplier later disallows the expense for that financial year. That is live tax exposure, so it is a constraint rather than a warning.

## Layout

```
src/app/(app)/dashboard/        Procurement: what needs you today
src/app/(app)/purchase-orders/  Build, issue and track orders
src/app/(app)/catalogue/        SKU codes and design series
src/app/(app)/inbound/          Warehouse: what is arriving, and the counting screen
src/app/(app)/bills/            Three-way match, approval, MSME ageing
src/app/(app)/portal/           Vendor: their orders, their codes, their bills
src/app/(app)/vendors/          Vendor master and KYC
src/app/login/          Dual-channel auth — phone OTP for vendors, magic link for staff
src/components/orders/  Order lines and thread, shared by staff and vendor screens
src/components/bills/   Bill upload, shared by both sides
src/lib/domain/         Status vocabulary and role capabilities — mirrors the DB, never defines it
src/lib/format/         Indian currency and deadline phrasing
src/lib/supabase/       server (RLS-bound) · admin (service role, provisioning only)
src/lib/auth/           Session resolution and RBAC helpers
src/lib/validation/     GSTIN / PAN / IFSC / phone / MSME
src/proxy.ts            Next.js 16 proxy (formerly middleware) — session refresh + route guard
supabase/migrations/    Schema, RLS, storage policies
tests/                  Isolation, workflow, migration guarantees, validation
docs/                   Setup, M0 spike checklist
```

The same order lines component renders for Procurement and for the vendor, on
purpose: two sides arguing from differently-formatted copies of the same order
is the problem this replaces.
