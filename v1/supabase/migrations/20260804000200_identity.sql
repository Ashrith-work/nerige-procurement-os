-- =============================================================================
-- M1 / 002 — Identity: app users, vendor orgs, and the vendor↔user join
-- =============================================================================
-- This migration defines the isolation anchor for the entire system.
--
-- The critical decision: a vendor is an ORGANISATION, not a login. A saree
-- vendor will have an owner plus a manager, and the owner's son will end up
-- with an account too. If isolation keyed on the user, adding a second login
-- would silently create a second data island. `vendor_users` makes the org the
-- unit of isolation and the login merely a member of it.
--
-- Every vendor-visible table from here to M9 carries `vendor_id` referencing
-- `vendors`. That column is the single anchor every RLS policy resolves.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- app_users — profile mirror of auth.users
-- -----------------------------------------------------------------------------
-- Supabase owns auth.users; we never write to it. This table holds the
-- application-level facts: role, status, display name, preferred language.
--
-- Role lives HERE, not in auth JWT app_metadata, because a role change must be
-- transactional with an audit-log entry and must take effect immediately. A
-- role baked into a JWT stays stale until the token refreshes — which means a
-- suspended user keeps their access for up to an hour. Unacceptable for a
-- system that moves money.
create table app_users (
  id            uuid primary key references auth.users (id) on delete restrict,
  role          app_role      not null,
  status        user_status   not null default 'invited',
  full_name     text          not null check (length(trim(full_name)) between 1 and 200),
  email         citext,
  phone         text,
  -- Vendor UI language. Your catalogue spans Kannada, Tamil and Telugu scripts,
  -- so vendors are unlikely to all read English.
  locale        text          not null default 'en'
                              check (locale in ('en', 'kn', 'ta', 'te', 'hi')),
  last_seen_at  timestamptz,
  created_at    timestamptz   not null default now(),
  updated_at    timestamptz   not null default now(),
  deleted_at    timestamptz,
  version       integer       not null default 1,

  -- Internal staff authenticate by email magic link; vendors by phone OTP.
  -- Enforce that the relevant identifier is actually present.
  constraint app_users_internal_needs_email
    check (role = 'vendor' or email is not null),
  constraint app_users_vendor_needs_phone
    check (role <> 'vendor' or phone is not null),
  -- E.164 India, or any E.164 for future international vendors.
  constraint app_users_phone_format
    check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$')
);

create unique index app_users_email_uniq
  on app_users (email) where deleted_at is null and email is not null;
create unique index app_users_phone_uniq
  on app_users (phone) where deleted_at is null and phone is not null;
create index app_users_role_idx on app_users (role) where deleted_at is null;

create trigger app_users_touch
  before update on app_users
  for each row execute function app.touch_row();
create trigger app_users_no_hard_delete
  before delete on app_users
  for each row execute function app.forbid_hard_delete();

comment on table app_users is
  'Application profile for every authenticated principal. Role lives here, not in the JWT, so revocation is immediate.';

-- -----------------------------------------------------------------------------
-- vendors — the vendor organisation and its KYC record
-- -----------------------------------------------------------------------------
create table vendors (
  id                    uuid primary key default gen_random_uuid(),

  -- Human-facing short code used on POs and in search (e.g. "SHAN", "WB").
  -- Your existing SKUs (shanwb14090, vintwb11987) appear to embed source codes
  -- already; this column is where that convention gets formalised in M2.
  code                  text        not null
                                    check (code ~ '^[A-Z0-9][A-Z0-9_-]{1,15}$'),
  legal_name            text        not null check (length(trim(legal_name)) between 2 and 200),
  display_name          text        not null check (length(trim(display_name)) between 2 and 120),
  status                vendor_status not null default 'draft',

  -- --- Tax & statutory identity -------------------------------------------
  gst_registration_type gst_registration_type not null default 'regular',
  -- 15 chars: 2 state + 10 PAN + 1 entity + 'Z' + 1 checksum.
  -- Format enforced here; full checksum validated in the application layer
  -- (src/lib/validation/india.ts) where the error message can be useful.
  gstin                 text        check (
                                      gstin is null or
                                      gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'
                                    ),
  pan                   text        check (pan is null or pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  -- GST state code, derived from gstin[1:2]. Drives CGST/SGST vs IGST in M6.
  state_code            text        check (state_code is null or state_code ~ '^[0-9]{2}$'),

  -- --- MSME / Section 43B(h) ----------------------------------------------
  -- If a vendor is micro or small and we pay beyond the statutory window, the
  -- expense is disallowed for that financial year. Captured at onboarding so
  -- M6 can raise ageing alerts before the deadline, not after.
  msme_category         msme_category not null default 'not_registered',
  udyam_number          text        check (
                                      udyam_number is null or
                                      udyam_number ~ '^UDYAM-[A-Z]{2}-[0-9]{2}-[0-9]{7}$'
                                    ),
  -- Agreed credit period. Capped at 45 for MSME vendors by trigger below.
  payment_terms_days    integer     not null default 30
                                    check (payment_terms_days between 0 and 180),

  -- --- Operational --------------------------------------------------------
  -- Seeded manually, then overwritten by observed data once M5 supplies real
  -- receipt timestamps. Used by M8 restock suggestions.
  default_lead_time_days integer    not null default 21
                                    check (default_lead_time_days between 0 and 365),
  primary_contact_name  text,
  primary_phone         text        check (primary_phone is null or primary_phone ~ '^\+[1-9][0-9]{7,14}$'),
  primary_email         citext,
  notes                 text,

  created_by            uuid        references app_users (id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz,
  version               integer     not null default 1,

  -- A GST-registered vendor must have a GSTIN. Guarantees we can never issue a
  -- compliant PO to a vendor whose tax identity is unknown.
  constraint vendors_regular_needs_gstin
    check (gst_registration_type <> 'regular' or gstin is not null),
  -- An MSME claim without a Udyam number is unverifiable and legally useless.
  constraint vendors_msme_needs_udyam
    check (msme_category = 'not_registered' or udyam_number is not null)
);

create unique index vendors_code_uniq  on vendors (code)  where deleted_at is null;
create unique index vendors_gstin_uniq on vendors (gstin) where deleted_at is null and gstin is not null;
create index vendors_status_idx on vendors (status) where deleted_at is null;
-- Trigram index: Procurement Head searches vendors by partial name constantly.
create index vendors_name_trgm_idx on vendors using gin (display_name gin_trgm_ops);

create trigger vendors_touch
  before update on vendors
  for each row execute function app.touch_row();
create trigger vendors_no_hard_delete
  before delete on vendors
  for each row execute function app.forbid_hard_delete();

-- Derive state_code from GSTIN and clamp MSME payment terms to the statutory
-- 45-day maximum. Doing this in the database means it holds regardless of which
-- code path wrote the row — including a future n8n import or a manual fix.
create or replace function app.vendors_normalise()
returns trigger
language plpgsql
as $$
begin
  if new.gstin is not null then
    new.state_code := substring(new.gstin from 1 for 2);
    -- GSTIN embeds the PAN at positions 3..12. If PAN was left blank, fill it.
    if new.pan is null then
      new.pan := substring(new.gstin from 3 for 10);
    end if;
  end if;

  if new.msme_category in ('micro', 'small') and new.payment_terms_days > 45 then
    raise exception
      'Vendor % is MSME (%): payment terms cannot exceed 45 days under Section 43B(h). Given: % days.',
      new.code, new.msme_category, new.payment_terms_days
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger vendors_normalise_trg
  before insert or update on vendors
  for each row execute function app.vendors_normalise();

comment on table vendors is
  'Vendor organisation + KYC. The isolation anchor: every vendor-visible row in the system references vendors.id.';
comment on column vendors.payment_terms_days is
  'Agreed credit period. Hard-capped at 45 for micro/small MSME vendors (Income Tax Act s.43B(h)).';

-- -----------------------------------------------------------------------------
-- vendor_users — which logins belong to which vendor organisation
-- -----------------------------------------------------------------------------
-- The table every RLS policy reads. Kept deliberately narrow and heavily
-- indexed because it is on the hot path of every single vendor query.
create table vendor_users (
  vendor_id   uuid        not null references vendors (id) on delete restrict,
  user_id     uuid        not null references app_users (id) on delete restrict,
  -- The owner can invite additional logins; staff cannot.
  is_owner    boolean     not null default false,
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  primary key (vendor_id, user_id)
);

-- A login belongs to exactly ONE vendor organisation. Without this, a
-- compromised or mis-provisioned account could span two vendors and the
-- isolation guarantee collapses.
create unique index vendor_users_one_org_per_user
  on vendor_users (user_id) where deleted_at is null;
create index vendor_users_vendor_idx
  on vendor_users (vendor_id) where deleted_at is null;

create trigger vendor_users_no_hard_delete
  before delete on vendor_users
  for each row execute function app.forbid_hard_delete();

comment on table vendor_users is
  'Join between a vendor organisation and its logins. Read by every RLS policy; one user maps to at most one vendor.';
