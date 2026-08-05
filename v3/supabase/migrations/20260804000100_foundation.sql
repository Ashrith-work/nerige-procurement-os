-- =============================================================================
-- 001 — Foundation: extensions, schemas, enums, shared conventions
-- =============================================================================
-- Carried over from the previous build, with everything that existed only to
-- serve accounts payable removed: the msme_category, gst_registration_type,
-- document_kind and audit_action enums are gone, because KYC, billing and the
-- audit trail are out of scope (spec §8).
--
-- What remains is what the portal actually needs:
--   * a private `app` schema for helper functions that must NOT be exposed
--     through PostgREST (anything in `public` is reachable by API clients)
--   * the two roles the product has
--   * the shared column conventions: updated_at, soft delete, optimistic locking
-- =============================================================================

create extension if not exists "pgcrypto";      -- gen_random_uuid()
create extension if not exists "citext";        -- case-insensitive email
create extension if not exists "pg_trgm";       -- fuzzy search on SKU and title

create schema if not exists app;
revoke all on schema app from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------

-- Two kinds of user, and only two. Pooja browses and issues; the vendor reads
-- her own orders and accepts them. The previous build carried `founder` (for
-- payment approval) and `warehouse_manager` (for goods receipt); both of those
-- workflows are out of scope, so both roles would be unreachable.
create type app_role as enum (
  'procurement_head',
  'vendor'
);

create type user_status as enum (
  'invited',      -- record exists, has never authenticated
  'active',
  'suspended'     -- blocked from signing in; retained for history
);

-- Vendor lifecycle, reduced to the states this build can actually reach.
-- `pending_kyc` is gone with KYC. Vendors arrive from the seed loader as
-- active; `on_hold` stops new orders, `archived` retires a weaver we no longer
-- work with without deleting the orders they were sent.
create type vendor_status as enum (
  'active',
  'on_hold',
  'archived'
);

-- -----------------------------------------------------------------------------
-- Shared triggers
-- -----------------------------------------------------------------------------

-- Maintains updated_at and increments the optimistic-concurrency version on
-- every UPDATE, so a lost update is detectable rather than silent.
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
-- or a stray admin query cannot destroy history.
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
