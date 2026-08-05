# Setup — M1

From nothing to a running system with a real vendor record. About 30 minutes.

## 0. Prerequisites

Node.js 20.9+ (this machine has 24.19.0 at `~/.local/node`, already on your `PATH` via `~/.zshrc`).

```bash
cd ~/nerige-procurement-os
npm install
```

## 1. Create the Supabase project

1. <https://supabase.com/dashboard> → **New project**
2. Region **Mumbai (ap-south-1)** — every user is in India, and this is the difference between a snappy portal and a sluggish one
3. Save the database password somewhere durable

## 2. Apply the migrations

Order matters — they are numbered. In the dashboard, **SQL Editor** → paste and run each in sequence:

```
supabase/migrations/20260804000100_foundation.sql
supabase/migrations/20260804000200_identity.sql
supabase/migrations/20260804000300_audit_and_outbox.sql
supabase/migrations/20260804000400_vendor_kyc.sql
supabase/migrations/20260804000500_rls_helpers.sql
supabase/migrations/20260804000600_rls_policies.sql
supabase/migrations/20260804000700_storage.sql
```

Do **not** run `supabase/tests/00_supabase_shim.sql` — that file recreates Supabase's own objects for the offline test harness and would conflict here.

> If you later install the Supabase CLI, `supabase db push` applies all of these in one command.

## 3. Environment

```bash
cp .env.example .env.local
```

Fill from **Project Settings → API**:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` — used only by `scripts/provision-user.ts`. Never commit it, never prefix it `NEXT_PUBLIC_`.

## 4. Auth configuration

**Authentication → URL Configuration**

- Site URL: `http://localhost:3000` (later your Vercel domain)
- Redirect URLs: add `http://localhost:3000/auth/callback`

Miss this and magic links land on an error page.

**Authentication → Providers → Email** — enable. Turn **off** "Enable email signups" if offered; provisioning is deliberate here, and the app already sends `shouldCreateUser: false`.

**Authentication → Providers → Phone** — required for vendor login. Configure an SMS provider:

- **MSG91** is the usual India choice — cheaper, and DLT registration is handled in their console
- **Twilio** works but costs more per message and still needs Indian DLT registration

Vendor sign-in silently fails until this is done. It is the one external dependency in M1.

## 5. Create your login

```bash
npm run provision -- --role founder --name "Your Name" --email you@nerigestory.com
```

Then `npm run dev`, open <http://localhost:3000>, choose **Nerige team**, enter that email, and follow the link.

## 6. Add a vendor, then a vendor login

Create a vendor through the UI (**Vendors → Add vendor**), then give them a login:

```bash
npm run provision -- --role vendor --name "Shan Owner" --phone 9876543210 --vendor-code SHAN
```

Signing in as that vendor is the fastest way to see isolation working: they see exactly one vendor record — their own.

## 7. Verify

```bash
npm run verify        # typecheck + lint + tests
npm run test:isolation
```

The isolation suite boots its own Postgres, applies every migration and asserts a vendor session can reach none of another vendor's rows. It needs no Supabase project and no network.

---

## Deploying to Vercel

1. Push to GitHub, import into Vercel
2. Add the same environment variables (`NEXT_PUBLIC_APP_URL` = your production domain)
3. Add `https://your-domain/auth/callback` to Supabase redirect URLs
4. Update Supabase **Site URL** to the production domain

---

## Things that will bite you

- **Vendor login does nothing** — SMS provider not configured (step 4).
- **Magic link goes to an error page** — redirect URL not allow-listed (step 4).
- **A query returns no rows for a user who should see them** — a missing RLS policy, not a bug in the app. Fix it in SQL. Do not reach for the service-role key; that disables the isolation guarantee everywhere.
- **`npm test` fails on a fresh clone** — `npm ci` first; the test harness needs the embedded Postgres binaries.
