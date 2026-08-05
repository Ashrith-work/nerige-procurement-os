-- =============================================================================
-- 002 — Identity: app users, vendor orgs, and the vendor↔user join
-- =============================================================================
-- The isolation anchor for the whole system.
--
-- The critical decision, unchanged from the previous build: a vendor is an
-- ORGANISATION, not a login. A weaver will have an owner plus a manager, and
-- the owner's son will end up with an account too. If isolation keyed on the
-- user, adding a second login would silently create a second data island.
-- `vendor_users` makes the org the unit of isolation and the login merely a
-- member of it.
--
-- `vendors` is stripped to the six columns spec §6 keeps. GSTIN, PAN, MSME
-- category, Udyam number, payment terms and bank details are gone — a weaver's
-- tax registration has no bearing on whether she can see a photograph of a
-- saree, which is the only thing this build is for.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- app_users — profile mirror of auth.users
-- -----------------------------------------------------------------------------
-- Supabase owns auth.users; we never write to it. This table holds the
-- application-level facts: role, status, display name, preferred language.
--
-- Role lives HERE, not in auth JWT app_metadata, because a role baked into a
-- JWT stays stale until the token refreshes — a suspended user would keep
-- access for up to an hour.
create table app_users (
  id            uuid primary key references auth.users (id) on delete restrict,
  role          app_role      not null,
  status        user_status   not null default 'invited',
  full_name     text          not null check (length(trim(full_name)) between 1 and 200),
  email         citext,
  phone         text,
  -- Vendor UI language (spec §7). The catalogue titles alone span Kannada,
  -- Telugu and Devanagari scripts, so the weavers reading this portal are
  -- unlikely to all read English. Retrofitting this column is painful, so it
  -- exists from the first migration.
  locale        text          not null default 'en'
                              check (locale in ('en', 'kn', 'ta', 'te', 'hi')),
  last_seen_at  timestamptz,
  created_at    timestamptz   not null default now(),
  updated_at    timestamptz   not null default now(),
  deleted_at    timestamptz,
  version       integer       not null default 1,

  -- Pooja authenticates by email magic link; vendors by phone OTP.
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
-- vendors — the weaver, as an organisation
-- -----------------------------------------------------------------------------
create table vendors (
  id                     uuid primary key default gen_random_uuid(),

  -- The SKU prefix, and the whole of vendor identity (spec §2). PGW-BRHM-SLK-
  -- CRM-5855 belongs to vendor PGW because the string says so; there is no
  -- product-to-vendor mapping table anywhere in this schema, on purpose.
  --
  -- Seed data contains two prefixes with trailing whitespace ('DMG ' from the
  -- SKU 'DMG - 157'). The loader normalises the derived code to upper case and
  -- trims it before it reaches this column; the SKU itself is stored verbatim,
  -- because that string gets copied onto a fabric label by hand.
  code                   text        not null
                                     check (code ~ '^[A-Z0-9][A-Z0-9_-]{1,15}$'),
  display_name           text        not null check (length(trim(display_name)) between 1 and 120),
  status                 vendor_status not null default 'active',
  primary_phone          text        check (primary_phone is null or primary_phone ~ '^\+[1-9][0-9]{7,14}$'),
  -- Seeded manually. Used to suggest a promised date when the vendor accepts.
  default_lead_time_days integer     not null default 21
                                     check (default_lead_time_days between 0 and 365),

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  deleted_at             timestamptz,
  version                integer     not null default 1
);

create unique index vendors_code_uniq on vendors (code) where deleted_at is null;
create index vendors_status_idx on vendors (status) where deleted_at is null;
-- Trigram index: Pooja picks a vendor by typing part of the name constantly.
create index vendors_name_trgm_idx on vendors using gin (display_name gin_trgm_ops);

create trigger vendors_touch
  before update on vendors
  for each row execute function app.touch_row();
create trigger vendors_no_hard_delete
  before delete on vendors
  for each row execute function app.forbid_hard_delete();

comment on table vendors is
  'The weaver, as an organisation. `code` is the SKU prefix and is the entire basis of vendor identity.';

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
-- mis-provisioned account could span two vendors and the isolation guarantee
-- collapses.
create unique index vendor_users_one_org_per_user
  on vendor_users (user_id) where deleted_at is null;
create index vendor_users_vendor_idx
  on vendor_users (vendor_id) where deleted_at is null;

create trigger vendor_users_no_hard_delete
  before delete on vendor_users
  for each row execute function app.forbid_hard_delete();

comment on table vendor_users is
  'Join between a vendor organisation and its logins. Read by every RLS policy; one user maps to at most one vendor.';
