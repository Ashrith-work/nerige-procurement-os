-- =============================================================================
-- 010 — Make the isolation policies fast enough to actually use
-- =============================================================================
-- The policies were correct and unusably slow. Measured on the real project, as
-- the HDR weaver (2,365 designs of 9,827):
--
--     select count(*) from products                     7,005 ms
--     select sku from products order by seq desc limit 48   5,996 ms
--     select facet, count(*) from vendor_facets group by facet  17,754 ms
--
-- Supabase's statement timeout for `authenticated` is 8 seconds, so the last
-- one did not merely crawl — it failed outright, and so did any query asking
-- PostgREST for an exact count.
--
-- The cause is `app.owns_vendor_row(vendor_id)`. It takes the ROW's vendor_id
-- as an argument, so Postgres cannot hoist it: it is re-evaluated per row, and
-- each evaluation calls app.current_vendor_id(), which joins vendor_users to
-- app_users. Nine thousand rows, nine thousand joins.
--
-- The fix is to compare against a scalar sub-select instead:
--
--     using (vendor_id = (select app.current_vendor_id()))
--
-- A `(select ...)` with no outer reference is an InitPlan — evaluated ONCE per
-- statement and then used as a constant, which also makes it an index-usable
-- equality predicate rather than an opaque function call. Same for
-- app.is_internal(), which took no row argument but was still called per row.
--
-- Semantics are unchanged. owns_vendor_row(p) was
--   `p is not null and current_vendor_id() is not null and p = current_vendor_id()`
-- and `p = (select current_vendor_id())` yields NULL — not true, so the row is
-- filtered — whenever either side is NULL. Every one of the 36 isolation
-- assertions still holds; they are what proves this refactor did not widen
-- anything.
--
-- app.owns_vendor_row() is deliberately LEFT IN PLACE. It is still the clearest
-- statement of the rule, and the isolation suite asserts it is not reachable as
-- a PostgREST RPC. It is simply no longer called from a policy.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- app_users
-- -----------------------------------------------------------------------------
drop policy if exists app_users_select_internal    on app_users;
drop policy if exists app_users_select_same_vendor on app_users;
drop policy if exists app_users_update_self        on app_users;
drop policy if exists app_users_manage_internal    on app_users;

create policy app_users_select_internal on app_users
  for select to authenticated
  using ((select app.is_internal()) and deleted_at is null);

create policy app_users_select_same_vendor on app_users
  for select to authenticated
  using (
    deleted_at is null
    and exists (
      select 1 from vendor_users vu
       where vu.user_id = app_users.id
         and vu.vendor_id = (select app.current_vendor_id())
         and vu.deleted_at is null
    )
  );

create policy app_users_update_self on app_users
  for update to authenticated
  using  (id = (select auth.uid()) and deleted_at is null)
  with check (
    id = (select auth.uid())
    and role   = (select app.current_role())
    and status = (select app.current_user_status())
    and deleted_at is null
  );

create policy app_users_manage_internal on app_users
  for update to authenticated
  using      ((select app.is_internal()))
  with check ((select app.is_internal()));

-- -----------------------------------------------------------------------------
-- vendors
-- -----------------------------------------------------------------------------
drop policy if exists vendors_select_internal on vendors;
drop policy if exists vendors_select_own      on vendors;

create policy vendors_select_internal on vendors
  for select to authenticated
  using ((select app.is_internal()) and deleted_at is null);

create policy vendors_select_own on vendors
  for select to authenticated
  using (id = (select app.current_vendor_id()) and deleted_at is null);

-- -----------------------------------------------------------------------------
-- vendor_users
-- -----------------------------------------------------------------------------
drop policy if exists vendor_users_select_internal on vendor_users;
drop policy if exists vendor_users_select_own      on vendor_users;

create policy vendor_users_select_internal on vendor_users
  for select to authenticated
  using ((select app.is_internal()) and deleted_at is null);

create policy vendor_users_select_own on vendor_users
  for select to authenticated
  using (vendor_id = (select app.current_vendor_id()) and deleted_at is null);

-- -----------------------------------------------------------------------------
-- products — the one that matters most
-- -----------------------------------------------------------------------------
drop policy if exists products_select_internal on products;
drop policy if exists products_select_own      on products;

create policy products_select_internal on products
  for select to authenticated
  using ((select app.is_internal()));

create policy products_select_own on products
  for select to authenticated
  using (vendor_id = (select app.current_vendor_id()));

-- -----------------------------------------------------------------------------
-- orders
-- -----------------------------------------------------------------------------
drop policy if exists orders_select_internal on orders;
drop policy if exists orders_select_own      on orders;
drop policy if exists orders_insert_internal on orders;
drop policy if exists orders_update_internal on orders;
drop policy if exists orders_update_own      on orders;

create policy orders_select_internal on orders
  for select to authenticated
  using ((select app.is_internal()));

create policy orders_select_own on orders
  for select to authenticated
  using (vendor_id = (select app.current_vendor_id()));

create policy orders_insert_internal on orders
  for insert to authenticated
  with check ((select app.is_internal()));

create policy orders_update_internal on orders
  for update to authenticated
  using      ((select app.is_internal()))
  with check ((select app.is_internal()));

create policy orders_update_own on orders
  for update to authenticated
  using      (vendor_id = (select app.current_vendor_id()))
  with check (vendor_id = (select app.current_vendor_id()));

-- -----------------------------------------------------------------------------
-- order_lines — still scoped through the parent order, never in app code
-- -----------------------------------------------------------------------------
drop policy if exists order_lines_select_internal on order_lines;
drop policy if exists order_lines_select_own      on order_lines;
drop policy if exists order_lines_insert_internal on order_lines;

create policy order_lines_select_internal on order_lines
  for select to authenticated
  using ((select app.is_internal()));

create policy order_lines_select_own on order_lines
  for select to authenticated
  using (
    exists (
      select 1 from orders o
       where o.id = order_lines.order_id
         and o.vendor_id = (select app.current_vendor_id())
    )
  );

create policy order_lines_insert_internal on order_lines
  for insert to authenticated
  with check (
    (select app.is_internal())
    and exists (select 1 from orders o where o.id = order_lines.order_id)
  );

-- -----------------------------------------------------------------------------
-- order_line_refs
-- -----------------------------------------------------------------------------
drop policy if exists order_line_refs_select_internal on order_line_refs;
drop policy if exists order_line_refs_select_own      on order_line_refs;
drop policy if exists order_line_refs_insert_internal on order_line_refs;

create policy order_line_refs_select_internal on order_line_refs
  for select to authenticated
  using ((select app.is_internal()));

create policy order_line_refs_select_own on order_line_refs
  for select to authenticated
  using (
    exists (
      select 1
        from order_lines ol
        join orders o on o.id = ol.order_id
       where ol.id = order_line_refs.order_line_id
         and o.vendor_id = (select app.current_vendor_id())
    )
  );

create policy order_line_refs_insert_internal on order_line_refs
  for insert to authenticated
  with check (
    (select app.is_internal())
    and exists (select 1 from order_lines ol where ol.id = order_line_refs.order_line_id)
  );

-- -----------------------------------------------------------------------------
-- Indexes for the catalogue's three filters
-- -----------------------------------------------------------------------------
-- The existing products_vendor_collection_seq_idx is (vendor_id, collection,
-- seq DESC), which cannot order by seq for a weaver browsing everything —
-- collection sits between the two. These cover the screen as it now behaves:
-- open on all her designs newest first, then narrow by colour or fabric.
create index if not exists products_vendor_seq_idx
  on products (vendor_id, seq desc);

create index if not exists products_vendor_colour_seq_idx
  on products (vendor_id, colour_code, seq desc);

create index if not exists products_vendor_fabric_seq_idx
  on products (vendor_id, fabric, seq desc);

comment on policy products_select_own on products is
  'Core vendor isolation. The scalar sub-select is load-bearing for performance: it makes current_vendor_id() an InitPlan evaluated once per statement, and the predicate index-usable.';
