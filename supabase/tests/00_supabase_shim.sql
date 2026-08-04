-- =============================================================================
-- TEST HARNESS ONLY — reproduces the Supabase-provided objects on vanilla Postgres
-- =============================================================================
-- This file is NEVER applied to a real Supabase project; there these objects
-- already exist. It exists so the vendor-isolation suite can run against a real
-- Postgres in CI without Docker or a network round trip to Supabase.
--
-- Fidelity matters here: auth.uid() is reproduced with the exact body Supabase
-- ships, because the isolation guarantee is only as good as the function the
-- policies actually call. A simplified stub would test a system we do not run.
-- =============================================================================

create schema if not exists auth;
create schema if not exists storage;

-- The three roles PostgREST assumes. NOLOGIN: tests reach them via SET ROLE.
-- Crucially these are NOT superusers — a superuser bypasses RLS entirely, so a
-- suite that forgot to switch roles would pass every isolation test while the
-- production system leaked.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end;
$$;

grant usage on schema public to anon, authenticated, service_role;

-- --- auth.users ---------------------------------------------------------------
-- Only the columns this application actually references.
create table if not exists auth.users (
  id                  uuid primary key default gen_random_uuid(),
  email               text,
  phone               text,
  raw_app_meta_data   jsonb default '{}'::jsonb,
  created_at          timestamptz not null default now()
);

-- Verbatim from Supabase. Reads the JWT `sub` claim injected per request.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid;
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text;
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid(), auth.role() to anon, authenticated, service_role;
grant select on auth.users to authenticated, service_role;

-- --- storage ------------------------------------------------------------------
create table if not exists storage.buckets (
  id                 text primary key,
  name               text not null,
  public             boolean not null default false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz not null default now()
);

create table if not exists storage.objects (
  id         uuid primary key default gen_random_uuid(),
  bucket_id  text references storage.buckets (id),
  name       text not null,
  owner      uuid,
  metadata   jsonb,
  created_at timestamptz not null default now()
);

alter table storage.objects enable row level security;
alter table storage.objects force row level security;

grant usage on schema storage to anon, authenticated, service_role;
grant select, insert, update on storage.objects to authenticated;
grant select on storage.buckets to authenticated;
