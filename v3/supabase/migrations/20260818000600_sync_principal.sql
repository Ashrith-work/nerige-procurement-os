-- =============================================================================
-- 025 — The scheduled sync could never authenticate
-- =============================================================================
-- Every sync RPC opens with:
--
--   if not (select app.is_internal()) then
--     raise exception 'Only the Nerige team can run a sync.'
--
-- and `app.is_internal()` resolves through `app.current_role()`, which reads
-- `app_users` for `auth.uid()`. The scheduled sync has no user: `/api/sync` is
-- called by Vercel Cron, proves itself with CRON_SECRET, and uses the
-- service-role client precisely because there is nobody to run as. So
-- `auth.uid()` is null, `current_role()` is null, `is_internal()` is false, and
-- the sync raised on its first write — every time, since the day it was written.
--
-- Verified against this project's own database:
--
--   current_user : service_role
--   session_user : authenticator
--   jwt_claims   : {"role":"service_role", ...}
--   auth.uid()   : null
--
-- The fix is a second principal, not a wider `is_internal()`. Widening that
-- function would touch the RLS policies of eleven migrations to solve a problem
-- in four functions — and it would be pure theatre besides, because the service
-- role carries BYPASSRLS and never consults a policy in the first place. The
-- explicit checks inside these functions are the only thing it has to satisfy,
-- so they are the only thing that changes.
-- =============================================================================

-- Reads the JWT claim rather than `current_user`, deliberately. Every function
-- below is SECURITY DEFINER, and inside one of those `current_user` is the
-- function's OWNER, not the caller — a check written against it would answer
-- for the wrong principal and quietly return false. `request.jwt.claims` is a
-- session GUC set by PostgREST before the call and is unaffected by SECURITY
-- DEFINER.
--
-- Not STRICT and not SECURITY DEFINER itself: it must read the CALLER's GUC.
create or replace function app.is_service_role()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    ''
  ) = 'service_role';
$$;

comment on function app.is_service_role() is
  'True when the caller is the Supabase service role — the scheduled sync and nothing else. Deliberately separate from is_internal(), which governs RLS for human sessions.';

grant execute on function app.is_service_role() to authenticated, service_role;

-- The principal permitted to run a sync: a signed-in member of the Nerige team,
-- or the scheduler. Named for the job rather than the roles so the next
-- machine-driven job asks the same question.
create or replace function app.is_sync_principal()
returns boolean
language sql
stable
set search_path = ''
as $$
  select (select app.is_internal()) or (select app.is_service_role());
$$;

comment on function app.is_sync_principal() is
  'Who may run a sync: Nerige staff with operational authority, or the service role acting as the scheduler.';

grant execute on function app.is_sync_principal() to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Repoint the four guards
-- -----------------------------------------------------------------------------
-- Rewritten in place rather than redefined, so this migration cannot drift from
-- whatever those function bodies say by the time it runs. Each is re-created
-- from its own current definition with only the guard expression replaced,
-- which also means a later migration that changes one of these bodies does not
-- have to remember to re-apply this fix.
do $$
declare
  v_fn   text;
  v_def  text;
  v_new  text;
begin
  foreach v_fn in array array[
    'public.sync_upsert_products(jsonb, timestamptz)',
    'public.sync_deactivate_missing(timestamptz)',
    'public.sync_upsert_sales(jsonb)',
    'public.rollup_sales()',
    'public.refresh_master_data_stats()'
  ] loop
    -- Skip anything not present: sales RPCs arrive in an earlier migration, but
    -- a partial database should not fail here.
    if to_regprocedure(v_fn) is null then
      continue;
    end if;

    v_def := pg_get_functiondef(to_regprocedure(v_fn));
    v_new := replace(v_def, 'app.is_internal()', 'app.is_sync_principal()');

    if v_new <> v_def then
      execute v_new;
      raise notice 'sync guard widened: %', v_fn;
    end if;
  end loop;
end;
$$;

-- Housekeeping: a diagnostic function created by hand while tracking this down.
drop function if exists public._probe_ctx();
