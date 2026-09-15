-- =============================================================================
-- 033 — The developer reads everything and writes nothing
-- =============================================================================
-- Why a role and not "give the developer an admin login": admin can write, and
-- every write an admin makes is real. A developer checking whether the warehouse
-- manager's screen renders properly must not be one mis-click away from
-- approving a saree, cancelling an order or editing a weaver's language.
--
-- So read-only is enforced HERE, in the database, rather than trusted to the
-- application. The mechanism is additive and nothing else:
--
--   * every row-level-secured table in `public` gains ONE permissive SELECT
--     policy, `<table>_developer_read`, true only for a developer;
--   * no INSERT, UPDATE or DELETE policy anywhere names the developer.
--
-- Permissive policies OR together, so the new policy widens reads for a
-- developer and changes nothing for anyone else — no existing predicate is
-- edited, and `app.is_internal()` (referenced in eleven migrations) is left
-- exactly as migration 021 defined it. Writes need a matching write policy;
-- there is none, so a developer's INSERT/UPDATE is refused by RLS whatever the
-- application does. The view-as switcher also refuses writes in the action
-- layer, but that is for a readable message — this file is the guarantee.
--
-- Views are `security_invoker` throughout this schema, so they follow the table
-- policies with no work of their own. The `security invoker` insight RPCs do
-- the same.
--
-- Nothing secret is stored in this schema — migration 013 is explicit that no
-- password exists in any form, and integration secrets live in the environment
-- — so "reads everything" exposes no credential.
-- =============================================================================

create or replace function app.is_developer()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(app.current_role() = 'developer', false);
$$;

comment on function app.is_developer() is
  'The developer: SELECT on every table, no write anywhere. Deliberately NOT part of is_internal() or is_staff().';

grant execute on function app.is_developer() to authenticated;

-- -----------------------------------------------------------------------------
-- The one helper every later migration uses
-- -----------------------------------------------------------------------------
-- A table created after this file does not inherit the loop below. Rather than
-- trusting each future migration to hand-write the policy the same way, they
-- call this. `tests/developer.test.ts` asserts that every RLS table carries the
-- policy, so forgetting to call it fails the suite rather than producing a
-- developer view of an empty screen.
--
-- Not granted to `authenticated`: it issues DDL, and only migrations run it.
create or replace function app.grant_developer_read(p_table regclass)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_name text := (select c.relname from pg_catalog.pg_class c where c.oid = p_table);
begin
  execute format(
    'drop policy if exists %I on %s',
    v_name || '_developer_read', p_table
  );
  execute format(
    'create policy %I on %s for select to authenticated using ((select app.is_developer()))',
    v_name || '_developer_read', p_table
  );
end;
$$;

revoke all on function app.grant_developer_read(regclass) from public;

-- -----------------------------------------------------------------------------
-- Every existing row-level-secured table
-- -----------------------------------------------------------------------------
do $$
declare
  t record;
begin
  for t in
    select c.oid::regclass as rel
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind = 'r'
       and c.relrowsecurity
  loop
    perform app.grant_developer_read(t.rel);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- view_as_log — every time the developer opened someone else's screens
-- -----------------------------------------------------------------------------
-- The same compensating control as `impersonation_log` (migration 012), for the
-- same reason: the developer can see any person's screens, so doing so leaves a
-- row. Separate from that table because its subject is a USER of any role, not
-- a vendor organisation, and bending `impersonation_log.vendor_id` to mean both
-- would break the isolation suite's reading of it.
--
-- The developer holds exactly two write rights in the whole schema, both here:
-- open a row as themself, and close their own row. Nothing else.
create table view_as_log (
  id                uuid        primary key default gen_random_uuid(),
  developer_user_id uuid        not null references app_users (id),
  target_user_id    uuid        not null references app_users (id),
  -- The role at the moment of viewing. app_users.role can change later, and
  -- "what did they see" is a question about then.
  target_role       app_role    not null,
  started_at        timestamptz not null default now(),
  ended_at          timestamptz
);

create index view_as_log_developer_idx on view_as_log (developer_user_id, started_at desc);
create index view_as_log_target_idx    on view_as_log (target_user_id, started_at desc);

comment on table view_as_log is
  'Every time a developer viewed the application as another user. Append-only; readable by the owner.';

alter table view_as_log enable row level security;
alter table view_as_log force row level security;

create policy view_as_log_select_admin on view_as_log
  for select to authenticated
  using ((select app.is_admin()));

create policy view_as_log_insert_developer on view_as_log
  for insert to authenticated
  with check ((select app.is_developer()) and developer_user_id = (select auth.uid()));

create policy view_as_log_close_developer on view_as_log
  for update to authenticated
  using      ((select app.is_developer()) and developer_user_id = (select auth.uid()))
  with check ((select app.is_developer()) and developer_user_id = (select auth.uid()));

select app.grant_developer_read('public.view_as_log');

grant select, insert, update on view_as_log to authenticated;
