-- =============================================================================
-- 005 — RLS helper functions
-- =============================================================================
-- The most security-critical objects in the system. Every isolation policy
-- resolves through these.
--
-- Four deliberate properties:
--
--  1. SECURITY DEFINER — they read app_users and vendor_users, which are
--     themselves RLS-protected. Running as owner both avoids infinite policy
--     recursion and prevents a caller from influencing the answer.
--
--  2. `set search_path = ''` with fully-qualified names — without this, a
--     caller who can create objects in a schema earlier on the search path can
--     shadow `app_users` with their own table and impersonate any vendor. This
--     is the classic SECURITY DEFINER privilege-escalation hole.
--
--  3. STABLE — the result cannot change within a statement, so the planner
--     evaluates them once per query rather than once per row. Across 9,838
--     products that is the difference between milliseconds and seconds.
--
--  4. Located in schema `app`, not `public` — anything in `public` is callable
--     as a PostgREST RPC. These must not be reachable from the wire.
--
-- Everything derives from auth.uid(). No caller-supplied vendor_id is ever
-- trusted, anywhere.
-- =============================================================================

-- Role of the calling user, or NULL if unauthenticated / suspended / deleted.
-- A suspended user resolves to NULL and therefore fails every policy — that is
-- how revocation takes effect within one request rather than one hour.
create or replace function app.current_role()
returns app_role
language sql
stable
security definer
set search_path = ''
as $$
  select u.role
    from public.app_users u
   where u.id = (select auth.uid())
     and u.status = 'active'
     and u.deleted_at is null;
$$;

-- Stored status of the calling user. Exists so that the app_users self-update
-- policy can pin `status` without subquerying app_users from inside an
-- app_users policy — that recurses infinitely. Any predicate over app_users
-- used in an app_users policy MUST go through a SECURITY DEFINER helper.
create or replace function app.current_user_status()
returns user_status
language sql
stable
security definer
set search_path = ''
as $$
  select u.status
    from public.app_users u
   where u.id = (select auth.uid())
     and u.deleted_at is null;
$$;

-- The vendor organisation the caller belongs to, or NULL for Pooja.
-- Reads the join table, so a weaver with three logins gets one shared island.
create or replace function app.current_vendor_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select vu.vendor_id
    from public.vendor_users vu
    join public.app_users u on u.id = vu.user_id
   where vu.user_id = (select auth.uid())
     and vu.deleted_at is null
     and u.status = 'active'
     and u.deleted_at is null
   limit 1;
$$;

-- True for procurement. False for vendors and for anonymous callers. With two
-- roles this is the whole of the staff side; there is no second internal role
-- to distinguish, because approval and receiving are out of scope.
create or replace function app.is_internal()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(app.current_role() = 'procurement_head', false);
$$;

-- The vendor side of every policy: true when the caller is a vendor user AND
-- the row belongs to their organisation. Written once so the isolation
-- predicate exists in exactly one place — a policy that hand-rolls
-- `vendor_id = app.current_vendor_id()` risks omitting the NULL guard, and
-- relying on `vendor_id = NULL` evaluating to NULL across dozens of policies
-- is how leaks happen.
create or replace function app.owns_vendor_row(p_vendor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_vendor_id is not null
     and app.current_vendor_id() is not null
     and p_vendor_id = app.current_vendor_id();
$$;

-- Execute rights: authenticated callers only. `anon` gets nothing anywhere in
-- this system — every table requires a session.
grant usage on schema app to authenticated;
grant execute on function
  app.current_role(),
  app.current_user_status(),
  app.current_vendor_id(),
  app.is_internal(),
  app.owns_vendor_row(uuid)
to authenticated;

comment on function app.current_vendor_id() is
  'Resolves the calling user''s vendor organisation from vendor_users. The single source of truth for vendor isolation; never accepts a caller-supplied id.';
