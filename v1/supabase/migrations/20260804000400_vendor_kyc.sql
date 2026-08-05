-- =============================================================================
-- M1 / 004 — Vendor KYC satellites: bank accounts, addresses, contacts, documents
-- =============================================================================
-- Split out of `vendors` rather than flattened into it, because each has a
-- genuine one-to-many:
--   * bank accounts change, and the OLD one must be retained — "which account
--     did we pay in March?" is a fraud question, not a curiosity
--   * a vendor has a registered address (GST) and a separate dispatch address
--   * a vendor has an owner, an accounts person, and a dispatch person
-- =============================================================================

-- -----------------------------------------------------------------------------
-- vendor_bank_accounts
-- -----------------------------------------------------------------------------
-- Bank-detail changes are the single most common vendor-fraud vector: an
-- attacker with WhatsApp access asks accounts to "update the account number".
-- Countermeasures built in here:
--   1. Accounts are never edited — a change means deactivating one row and
--      inserting another, so history is intact.
--   2. Exactly one active account per vendor, enforced by partial unique index.
--   3. A new account requires explicit verification before M6 will pay it.
--   4. The audit trigger redacts account_number (see migration 003).
create table vendor_bank_accounts (
  id                  uuid        primary key default gen_random_uuid(),
  vendor_id           uuid        not null references vendors (id) on delete restrict,
  account_holder_name text        not null check (length(trim(account_holder_name)) between 2 and 200),
  account_number      text        not null check (account_number ~ '^[0-9]{6,20}$'),
  ifsc                text        not null check (ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
  bank_name           text,
  branch_name         text,

  is_active           boolean     not null default true,
  -- Second-person verification. M6 refuses to schedule payment to an
  -- unverified account.
  verified_at         timestamptz,
  verified_by         uuid        references app_users (id),

  created_by          uuid        references app_users (id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,
  version             integer     not null default 1,

  constraint vendor_bank_verified_pair
    check ((verified_at is null) = (verified_by is null))
);

create unique index vendor_bank_one_active
  on vendor_bank_accounts (vendor_id)
  where is_active and deleted_at is null;
create index vendor_bank_vendor_idx
  on vendor_bank_accounts (vendor_id) where deleted_at is null;

create trigger vendor_bank_touch
  before update on vendor_bank_accounts
  for each row execute function app.touch_row();
create trigger vendor_bank_no_hard_delete
  before delete on vendor_bank_accounts
  for each row execute function app.forbid_hard_delete();

-- Any change to banking details raises an event. In M6 this becomes an alert to
-- the Founder; from day one it is at least on the record.
create or replace function app.vendor_bank_alert()
returns trigger
language plpgsql
as $$
begin
  perform app.emit_event(
    'vendor.bank_account.' || case tg_op when 'INSERT' then 'added' else 'changed' end,
    jsonb_build_object(
      'vendor_id',       new.vendor_id,
      'bank_account_id', new.id,
      'ifsc',            new.ifsc,
      -- Last four digits only: enough to identify, useless to an attacker.
      'account_last4',   right(new.account_number, 4),
      'actor_id',        auth.uid()
    ),
    new.vendor_id, 'vendor_bank_account', new.id
  );
  return null;
end;
$$;

create trigger vendor_bank_alert_trg
  after insert or update on vendor_bank_accounts
  for each row execute function app.vendor_bank_alert();

comment on table vendor_bank_accounts is
  'Vendor payout accounts. Superseded rows are deactivated, never edited — bank-detail change is a known fraud vector.';

-- -----------------------------------------------------------------------------
-- vendor_addresses
-- -----------------------------------------------------------------------------
create type address_kind as enum ('registered', 'dispatch', 'billing');

create table vendor_addresses (
  id           uuid         primary key default gen_random_uuid(),
  vendor_id    uuid         not null references vendors (id) on delete restrict,
  kind         address_kind not null,
  line1        text         not null check (length(trim(line1)) between 3 and 200),
  line2        text,
  city         text         not null,
  district     text,
  state        text         not null,
  -- GST state code. Must match the vendor's GSTIN prefix on the registered
  -- address, and drives CGST/SGST vs IGST determination in M6.
  state_code   text         not null check (state_code ~ '^[0-9]{2}$'),
  pincode      text         not null check (pincode ~ '^[1-9][0-9]{5}$'),
  country      text         not null default 'IN' check (country ~ '^[A-Z]{2}$'),
  is_primary   boolean      not null default false,
  created_at   timestamptz  not null default now(),
  updated_at   timestamptz  not null default now(),
  deleted_at   timestamptz,
  version      integer      not null default 1
);

create unique index vendor_addresses_one_primary_per_kind
  on vendor_addresses (vendor_id, kind)
  where is_primary and deleted_at is null;
create index vendor_addresses_vendor_idx
  on vendor_addresses (vendor_id) where deleted_at is null;

create trigger vendor_addresses_touch
  before update on vendor_addresses
  for each row execute function app.touch_row();
create trigger vendor_addresses_no_hard_delete
  before delete on vendor_addresses
  for each row execute function app.forbid_hard_delete();

-- -----------------------------------------------------------------------------
-- vendor_contacts
-- -----------------------------------------------------------------------------
-- Distinct from vendor_users: a contact is a person we might phone, a user is
-- a person who can log in. The accounts clerk who never touches the portal
-- still needs to be reachable when an invoice is queried.
create table vendor_contacts (
  id          uuid        primary key default gen_random_uuid(),
  vendor_id   uuid        not null references vendors (id) on delete restrict,
  name        text        not null check (length(trim(name)) between 2 and 120),
  designation text,
  phone       text        check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$'),
  email       citext,
  -- Which topics this person handles: 'orders', 'accounts', 'dispatch', 'quality'.
  purposes    text[]      not null default '{}',
  is_primary  boolean     not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  version     integer     not null default 1,

  constraint vendor_contacts_needs_channel
    check (phone is not null or email is not null)
);

create unique index vendor_contacts_one_primary
  on vendor_contacts (vendor_id) where is_primary and deleted_at is null;
create index vendor_contacts_vendor_idx
  on vendor_contacts (vendor_id) where deleted_at is null;

create trigger vendor_contacts_touch
  before update on vendor_contacts
  for each row execute function app.touch_row();
create trigger vendor_contacts_no_hard_delete
  before delete on vendor_contacts
  for each row execute function app.forbid_hard_delete();

-- -----------------------------------------------------------------------------
-- documents — generic attachment metadata
-- -----------------------------------------------------------------------------
-- Built generic in M1 because every later milestone attaches files: KYC now,
-- PO PDFs in M3, dispatch photos in M4, QC evidence in M5, invoices in M6.
-- `owner_type` + `owner_id` is a deliberate polymorphic association: a hard FK
-- per owner table would mean altering this table in every future milestone.
--
-- storage_path is the ONLY link to Supabase Storage, and it always begins with
-- `vendors/{vendor_id}/` so the storage RLS policy in migration 007 can enforce
-- isolation on the object itself, not merely on this metadata row.
create table documents (
  id             uuid          primary key default gen_random_uuid(),
  vendor_id      uuid          references vendors (id) on delete restrict,
  owner_type     text          not null check (owner_type ~ '^[a-z][a-z0-9_]*$'),
  owner_id       uuid          not null,
  kind           document_kind not null default 'other',

  storage_bucket text          not null default 'vendor-documents',
  storage_path   text          not null,
  file_name      text          not null,
  mime_type      text          not null,
  size_bytes     bigint        not null check (size_bytes > 0 and size_bytes <= 26214400), -- 25 MB
  -- SHA-256 of the content. Detects the duplicate-invoice-upload edge case
  -- flagged in the plan, before it reaches three-way match in M6.
  content_sha256 text          check (content_sha256 is null or content_sha256 ~ '^[a-f0-9]{64}$'),

  uploaded_by    uuid          references app_users (id),
  created_at     timestamptz   not null default now(),
  updated_at     timestamptz   not null default now(),
  deleted_at     timestamptz,
  version        integer       not null default 1,

  -- Enforces the storage layout that the bucket policy depends on. Without
  -- this, a mis-set path would silently bypass storage isolation.
  constraint documents_vendor_path_prefix
    check (
      vendor_id is null
      or storage_path like 'vendors/' || vendor_id::text || '/%'
    )
);

create unique index documents_storage_path_uniq
  on documents (storage_bucket, storage_path) where deleted_at is null;
create index documents_owner_idx  on documents (owner_type, owner_id) where deleted_at is null;
create index documents_vendor_idx on documents (vendor_id) where deleted_at is null;
create index documents_sha_idx    on documents (content_sha256) where content_sha256 is not null and deleted_at is null;

create trigger documents_touch
  before update on documents
  for each row execute function app.touch_row();
create trigger documents_no_hard_delete
  before delete on documents
  for each row execute function app.forbid_hard_delete();

comment on table documents is
  'Polymorphic attachment metadata. storage_path is always vendors/{vendor_id}/... so bucket RLS can enforce isolation on the object itself.';

select app.enable_audit('vendor_bank_accounts');
select app.enable_audit('vendor_addresses');
select app.enable_audit('vendor_contacts');
select app.enable_audit('documents');
