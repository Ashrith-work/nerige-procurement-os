-- =============================================================================
-- 021 — Authorization helpers for five roles
-- =============================================================================
-- Every function here inherits the four properties migration 005 established,
-- and for the same reasons: SECURITY DEFINER (they read app_users, which is
-- itself RLS-protected, so running as owner avoids policy recursion and stops a
-- caller influencing the answer), `set search_path = ''` with fully-qualified
-- names (without it, anyone who can create objects in an earlier schema can
-- shadow app_users and impersonate any role), STABLE (evaluated once per query
-- rather than once per row), and located in `app` rather than `public` (anything
-- in public is callable as a PostgREST RPC; these must not be reachable from the
-- wire).
--
-- THE ONE CHANGE TO EXISTING SECURITY SURFACE
--
-- `app.is_internal()` is referenced by policies across eleven migrations —
-- orders, sales, sync, vendor credentials, impersonation, app_settings. Adding
-- three roles made its definition a decision rather than a formality.
--
-- It gains `admin` and nothing else. Widening it to all four staff roles would
-- have been one word and would have handed a customer-support login every
-- config screen, every stored vendor credential and the sync controls, silently,
-- across eleven files nobody would have re-read. The two new staff roles
-- therefore start with no access at all and are granted capabilities one at a
-- time, explicitly, in 022. Fail closed.
--
-- Admin inheriting everything procurement_head can do is the intended and
-- audited consequence: it is how "the owner has every control" is delivered
-- without writing `or role = 'admin'` into eleven files.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- The widened predicate
-- -----------------------------------------------------------------------------
create or replace function app.is_internal()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(app.current_role() in ('admin', 'procurement_head'), false);
$$;

comment on function app.is_internal() is
  'Nerige staff with operational authority: admin and procurement_head. NOT warehouse_manager or customer_support — those are granted capabilities explicitly. Referenced by policies in eleven migrations; widen only deliberately.';

-- -----------------------------------------------------------------------------
-- The owner
-- -----------------------------------------------------------------------------
-- Sole authority over anything a customer can already see: published product
-- details, images, deletion. Also master data, configuration, user management
-- and impersonation. A suspended admin resolves to NULL through
-- app.current_role() and fails this in the same request, not in an hour.
create or replace function app.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(app.current_role() = 'admin', false);
$$;

comment on function app.is_admin() is
  'The owner. Every correction to a published product routes through this and nothing else.';

-- -----------------------------------------------------------------------------
-- Any non-vendor
-- -----------------------------------------------------------------------------
-- Read scope, not write scope. Used for looking things up: the intake queue and
-- a product page are visible to everyone who works at Nerige, because a
-- warehouse team has more than one person and support has to be able to answer
-- "where is this saree" about anything. Writes are scoped per capability below.
create or replace function app.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    app.current_role() in
      ('admin', 'procurement_head', 'warehouse_manager', 'customer_support'),
    false
  );
$$;

comment on function app.is_staff() is
  'Any authenticated Nerige employee — the four non-vendor roles. Read scope only; never use this to gate a write.';

-- -----------------------------------------------------------------------------
-- Capabilities
-- -----------------------------------------------------------------------------
-- Named after the action rather than the role, so the next module grants a
-- capability instead of re-deriving a role list. When a sixth role arrives it is
-- added here, once, and every policy referencing the capability follows.

-- Who may create a new saree.
create or replace function app.can_submit_intake()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(app.current_role() in ('admin', 'warehouse_manager'), false);
$$;

-- Who may approve or reject at review. Deliberately excludes
-- warehouse_manager: the person who submits and shoots a saree is not the
-- person who signs it off.
create or replace function app.can_review_intake()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(app.current_role() in ('admin', 'procurement_head'), false);
$$;

comment on function app.can_submit_intake() is
  'Separation of duties: submitting is not reviewing.';
comment on function app.can_review_intake() is
  'Approval authority. Excludes warehouse_manager on purpose.';

-- Execute rights, stated rather than inherited. PostgreSQL grants EXECUTE to
-- PUBLIC on a new function by default, so these would work today without this
-- block — but migration 005 names its grants explicitly, and a later
-- `revoke execute on all functions in schema app from public` would otherwise
-- turn every policy below into "permission denied for function" at runtime,
-- which reads as an outage rather than as a permissions change.
grant execute on function
  app.is_admin(),
  app.is_staff(),
  app.can_submit_intake(),
  app.can_review_intake()
to authenticated;
