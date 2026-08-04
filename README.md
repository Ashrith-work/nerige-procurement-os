# Nerige Story — Procurement OS

The system of record for everything between *"we need stock"* and *"the vendor has been paid."*

Next.js 16 (App Router) · TypeScript · Tailwind 4 · Supabase (Postgres + Auth + Storage + RLS) · n8n · Vercel

---

## Status — M1 (Foundation) complete

| Milestone | Scope | State |
| --- | --- | --- |
| M0 | Warehouse & ERP spike — no code, see [docs/M0-warehouse-erp-spike.md](docs/M0-warehouse-erp-spike.md) | Ready to run |
| **M1** | **Identity, vendor master, KYC, audit, outbox, RLS** | **Done** |
| M2 | Product mirror + vendor SKU mapping | Not started |
| M3 | Purchase orders | Not started |
| M4 | Vendor portal | Not started |
| M5 | Receipt & QC | Shape set by M0 |
| M6 | Settlement (3-way match, Founder approval, MSME ageing) | Not started |
| M7 | Analytics & vendor scorecards | Not started |
| M8 | Demand signals / restock suggestions | Not started |
| M9 | Design requests & sampling | Not started |

Start at [docs/SETUP.md](docs/SETUP.md).

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

---

## Commands

```bash
npm run dev              # development server
npm run verify           # typecheck + lint + full test suite
npm run test:isolation   # vendor isolation suite only
npm run provision -- --role founder --name "..." --email "..."
```

## Tests

`npm test` boots a real Postgres (no Docker, no network), applies every migration, and runs 59 assertions. It is not a mock — RLS, `SECURITY DEFINER` search-path pinning, CHECK constraints and triggers have no meaningful mock.

The isolation suite discovers every table carrying a `vendor_id` **from the system catalog** and asserts a vendor session can see none of another vendor's rows. Tables added in M3–M9 are covered the moment they exist; nobody has to remember to extend the file.

It also asserts things that are easy to get wrong and silent when wrong:

- RLS is *forced*, not merely enabled, on every table
- every `SECURITY DEFINER` function pins `search_path`
- `anon` holds no privilege anywhere
- a suspended user loses access within the same request
- a vendor cannot promote themselves, reactivate themselves, or grant themselves another vendor

## India statutory handling

GSTIN checksums are verified (not just format-matched), the PAN embedded in a GSTIN is cross-checked, and **MSME payment terms are capped at 45 days in the database** — under Income Tax Act s.43B(h), paying a micro or small supplier later disallows the expense for that financial year. That is live tax exposure, so it is a constraint rather than a warning.

## Layout

```
src/app/(app)/          Authenticated application (role-filtered shell)
src/app/login/          Dual-channel auth — phone OTP for vendors, magic link for staff
src/lib/supabase/       server (RLS-bound) · admin (service role, provisioning only)
src/lib/auth/           Session resolution and RBAC helpers
src/lib/validation/     GSTIN / PAN / IFSC / phone / MSME
src/proxy.ts            Next.js 16 proxy (formerly middleware) — session refresh + route guard
supabase/migrations/    Schema, RLS, storage policies
tests/                  Isolation suite, migration guarantees, validation
docs/                   Setup, M0 spike checklist
```
