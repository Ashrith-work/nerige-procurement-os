-- =============================================================================
-- 006 — Row Level Security policies
-- =============================================================================
-- Deny by default. RLS is enabled on every table; a table with RLS on and no
-- matching policy returns zero rows. Privileges are then granted back narrowly.
--
-- FORCE ROW LEVEL SECURITY is set on every table so that policies apply even to
-- the table owner. Without it, any connection that happens to run as owner
-- silently bypasses all isolation.
--
-- `anon` receives no privileges anywhere. Every table requires a session.
--
-- The two tables that carry no vendor_id of their own — order_lines and
-- order_line_refs — are scoped through their parent order IN THE POLICY, never
-- in application code (spec §6). A missing WHERE clause in a page must not be
-- able to leak one weaver's order to another.
-- =============================================================================

-- Start from zero. Supabase grants broad privileges on `public` by default;
-- we withdraw them and re-grant per table.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

alter table app_users       enable row level security;
alter table vendors         enable row level security;
alter table vendor_users    enable row level security;
alter table products        enable row level security;
alter table orders          enable row level security;
alter table order_lines     enable row level security;
alter table order_line_refs enable row level security;

alter table app_users       force row level security;
alter table vendors         force row level security;
alter table vendor_users    force row level security;
alter table products        force row level security;
alter table orders          force row level security;
alter table order_lines     force row level security;
alter table order_line_refs force row level security;

-- -----------------------------------------------------------------------------
-- app_users
-- -----------------------------------------------------------------------------
grant select on app_users to authenticated;
grant update on app_users to authenticated;   -- constrained to self by policy

-- Everyone can read their own profile. Without this the app cannot even
-- determine who is logged in.
create policy app_users_select_self on app_users
  for select to authenticated
  using (id = (select auth.uid()) and deleted_at is null);

create policy app_users_select_internal on app_users
  for select to authenticated
  using (app.is_internal() and deleted_at is null);

-- A vendor user may see co-workers in their own organisation, so the portal can
-- show which of the weaver's logins accepted an order.
create policy app_users_select_same_vendor on app_users
  for select to authenticated
  using (
    deleted_at is null
    and app.current_vendor_id() is not null
    and exists (
      select 1 from vendor_users vu
       where vu.user_id = app_users.id
         and vu.vendor_id = app.current_vendor_id()
         and vu.deleted_at is null
    )
  );

-- Self-service profile edits: display name and language only. Language matters
-- here — a weaver switching the portal to Kannada must not need Pooja.
--
-- Role and status are pinned by the WITH CHECK below. Postgres has no
-- column-level RLS, so the guard compares the proposed row against the stored
-- one. The stored values come from SECURITY DEFINER helpers rather than an
-- inline subquery: reading app_users from inside an app_users policy recurses
-- infinitely. Fails closed for a suspended user, whose current_role() is NULL.
create policy app_users_update_self on app_users
  for update to authenticated
  using  (id = (select auth.uid()) and deleted_at is null)
  with check (
    id = (select auth.uid())
    and role   = app.current_role()
    and status = app.current_user_status()
    and deleted_at is null
  );

create policy app_users_manage_internal on app_users
  for update to authenticated
  using (app.is_internal())
  with check (app.is_internal());

-- INSERT is service-role only: creating a login means creating the auth.users
-- row and the app_users row together, which is not expressible under RLS.

-- -----------------------------------------------------------------------------
-- vendors
-- -----------------------------------------------------------------------------
-- Read-only to every authenticated caller. Vendors arrive from the seed loader,
-- which runs as the owner; there is no vendor-creation screen in this build, so
-- granting INSERT would be unearned attack surface.
grant select on vendors to authenticated;

create policy vendors_select_internal on vendors
  for select to authenticated
  using (app.is_internal() and deleted_at is null);

-- The core isolation rule. A vendor sees exactly one vendor row: their own.
create policy vendors_select_own on vendors
  for select to authenticated
  using (app.owns_vendor_row(id) and deleted_at is null);

-- -----------------------------------------------------------------------------
-- vendor_users
-- -----------------------------------------------------------------------------
grant select on vendor_users to authenticated;

create policy vendor_users_select_internal on vendor_users
  for select to authenticated
  using (app.is_internal() and deleted_at is null);

create policy vendor_users_select_own on vendor_users
  for select to authenticated
  using (app.owns_vendor_row(vendor_id) and deleted_at is null);

-- -----------------------------------------------------------------------------
-- products
-- -----------------------------------------------------------------------------
-- Pooja sees the whole catalogue; a weaver sees only her own designs, on both
-- /portal/catalogue and inside her orders.
--
-- Writes belong to the loader, which connects as the owner and is a script, not
-- an application code path. No INSERT or UPDATE grant exists here at all.
grant select on products to authenticated;

create policy products_select_internal on products
  for select to authenticated
  using (app.is_internal());

create policy products_select_own on products
  for select to authenticated
  using (app.owns_vendor_row(vendor_id));

-- -----------------------------------------------------------------------------
-- orders
-- -----------------------------------------------------------------------------
grant select, insert, update on orders to authenticated;
-- The order_number default calls nextval(); without this an insert fails with
-- "permission denied for sequence" rather than anything that explains itself.
grant usage on sequence order_number_seq to authenticated;

create policy orders_select_internal on orders
  for select to authenticated
  using (app.is_internal());

create policy orders_select_own on orders
  for select to authenticated
  using (app.owns_vendor_row(vendor_id));

create policy orders_insert_internal on orders
  for insert to authenticated
  with check (app.is_internal());

create policy orders_update_internal on orders
  for update to authenticated
  using  (app.is_internal())
  with check (app.is_internal());

-- The vendor's own writes: accept, then dispatch. The policy proves the order
-- is hers; WHICH columns she may touch is settled by the trigger below, because
-- Postgres has no column-level RLS.
create policy orders_update_own on orders
  for update to authenticated
  using  (app.owns_vendor_row(vendor_id))
  with check (app.owns_vendor_row(vendor_id));

-- -----------------------------------------------------------------------------
-- What a vendor may write on her own order
-- -----------------------------------------------------------------------------
-- "Accept button at the bottom with a promised date. After accepting, the
-- vendor can set a dispatch date and a transport docket number. That is all a
-- vendor can write." (spec §5)
--
-- Three columns, and a status that only moves forward. A vendor rewriting the
-- quantity on the order she was sent is two sides arguing from differently
-- worded copies of the same order, which is the thing this portal replaces.
create or replace function app.orders_vendor_write_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vendor uuid := app.current_vendor_id();
begin
  -- Not a vendor session: procurement, or the loader. The policy already ruled.
  if v_vendor is null then
    return new;
  end if;

  if new.id           is distinct from old.id
     or new.batch_id     is distinct from old.batch_id
     or new.vendor_id    is distinct from old.vendor_id
     or new.order_number is distinct from old.order_number
     or new.issued_at    is distinct from old.issued_at
     or new.created_by   is distinct from old.created_by then
    raise exception
      'A vendor cannot change the identity of an order.'
      using errcode = 'insufficient_privilege';
  end if;

  if new.status is distinct from old.status
     and not (
       (old.status = 'issued'   and new.status = 'accepted')
       or (old.status = 'accepted' and new.status = 'dispatched')
     ) then
    raise exception
      'A vendor can accept an issued order or dispatch an accepted one, nothing else (% to %).',
      old.status, new.status
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

create trigger orders_vendor_write_guard_trg
  before update on orders
  for each row execute function app.orders_vendor_write_guard();

-- -----------------------------------------------------------------------------
-- order_lines
-- -----------------------------------------------------------------------------
-- No vendor_id column, by design (spec §6). Scoped through the parent order in
-- the policy: the EXISTS below is itself subject to the orders policies above,
-- so a line is visible exactly when its order is.
grant select, insert on order_lines to authenticated;

create policy order_lines_select_internal on order_lines
  for select to authenticated
  using (app.is_internal());

create policy order_lines_select_own on order_lines
  for select to authenticated
  using (
    exists (
      select 1 from orders o
       where o.id = order_lines.order_id
         and app.owns_vendor_row(o.vendor_id)
    )
  );

create policy order_lines_insert_internal on order_lines
  for insert to authenticated
  with check (
    app.is_internal()
    and exists (select 1 from orders o where o.id = order_lines.order_id)
  );

-- No UPDATE and no DELETE grant. Pooja revises an order by cancelling it and
-- issuing another; the vendor never edits what she was sent.

-- -----------------------------------------------------------------------------
-- order_line_refs
-- -----------------------------------------------------------------------------
grant select, insert on order_line_refs to authenticated;

create policy order_line_refs_select_internal on order_line_refs
  for select to authenticated
  using (app.is_internal());

create policy order_line_refs_select_own on order_line_refs
  for select to authenticated
  using (
    exists (
      select 1
        from order_lines ol
        join orders o on o.id = ol.order_id
       where ol.id = order_line_refs.order_line_id
         and app.owns_vendor_row(o.vendor_id)
    )
  );

create policy order_line_refs_insert_internal on order_line_refs
  for insert to authenticated
  with check (
    app.is_internal()
    and exists (select 1 from order_lines ol where ol.id = order_line_refs.order_line_id)
  );

comment on policy orders_select_own on orders is
  'Core vendor isolation. Combined with vendor_users_one_org_per_user, guarantees a vendor login resolves to exactly one vendor and therefore one set of orders.';
comment on policy order_lines_select_own on order_lines is
  'order_lines carries no vendor_id. Its isolation is the parent order''s, resolved here rather than in any page query.';
