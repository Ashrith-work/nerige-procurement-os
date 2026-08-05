-- =============================================================================
-- M1 / 001 — Foundation: extensions, schemas, enums, shared conventions
-- =============================================================================
-- Establishes the primitives every later migration depends on:
--   * a private `app` schema for helper functions that must NOT be exposed
--     through PostgREST (anything in `public` is reachable by API clients)
--   * the enums that encode the procurement lifecycle
--   * the shared column conventions: updated_at, soft delete, optimistic locking
--
-- Design note: helper functions live in `app`, never `public`. A SECURITY
-- DEFINER function in `public` is callable as an RPC by any authenticated
-- client, which would hand vendors a way to probe the isolation helpers.
-- =============================================================================

create extension if not exists "pgcrypto";      -- gen_random_uuid()
create extension if not exists "citext";        -- case-insensitive email
create extension if not exists "pg_trgm";       -- fuzzy search on vendor/SKU codes

create schema if not exists app;
revoke all on schema app from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------

-- The four roles from the brief. `founder` is a superset of `procurement_head`
-- for read access but is the ONLY role that can approve vendor invoices (M6).
create type app_role as enum (
  'founder',
  'procurement_head',
  'warehouse_manager',
  'vendor'
);

create type user_status as enum (
  'invited',      -- record exists, has never authenticated
  'active',
  'suspended'     -- blocked from signing in; retained for audit integrity
);

-- Vendor lifecycle. A vendor cannot receive a PO until 'active', which requires
-- KYC completion. This is the control that stops payments to unvetted vendors.
create type vendor_status as enum (
  'draft',            -- being entered by Procurement Head
  'pending_kyc',      -- awaiting document upload / verification
  'active',
  'on_hold',          -- temporarily not issuing new POs (quality, dispute)
  'blacklisted',      -- permanent; existing open POs must still settle
  'archived'
);

-- Drives Section 43B(h) MSME 45-day payment exposure (see M6 ageing alerts).
create type msme_category as enum (
  'not_registered',
  'micro',
  'small',
  'medium'
);

-- India GST registration type. Determines whether we can claim input credit and
-- whether reverse charge applies on the vendor's invoices.
create type gst_registration_type as enum (
  'regular',
  'composition',
  'unregistered',
  'exempt'
);

create type document_kind as enum (
  'gst_certificate',
  'pan_card',
  'cancelled_cheque',
  'msme_certificate',
  'bank_statement',
  'agreement',
  'other'
);

-- Append-only audit actions.
create type audit_action as enum ('insert', 'update', 'delete');

-- -----------------------------------------------------------------------------
-- Shared triggers
-- -----------------------------------------------------------------------------

-- Maintains updated_at and increments the optimistic-concurrency version on
-- every UPDATE. Two Procurement Heads editing the same PO (M3) is a real
-- scenario; the version column lets the app detect a lost update instead of
-- silently overwriting.
create or replace function app.touch_row()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  new.version    := coalesce(old.version, 0) + 1;
  return new;
end;
$$;

-- Blocks hard DELETE on tables that must retain history. Callers set
-- deleted_at instead. Enforced in the database so a forgotten `WHERE` clause
-- or a stray admin query cannot destroy an audit trail.
create or replace function app.forbid_hard_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'Hard delete is not permitted on %. Set deleted_at instead.', tg_table_name
    using errcode = 'restrict_violation';
end;
$$;

comment on schema app is
  'Private helpers and security functions. Not exposed via PostgREST.';
