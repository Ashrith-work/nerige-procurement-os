-- =============================================================================
-- 012 — Looking at a weaver's portal as she sees it, and saying so
-- =============================================================================
-- Pooja can already read every vendor's rows: `products_select_internal` and
-- `orders_select_internal` see everything. So impersonation adds no access —
-- what it adds is FIDELITY. A screen assembled by an admin tool from the same
-- data is not the screen the weaver is looking at; it is a second rendering
-- that can drift, and the whole point of opening it is to answer "what is she
-- seeing?" when she rings up confused.
--
-- It is read-only, and that is enforced in the action layer rather than here,
-- because the admin's own RLS grants genuinely do permit those writes. The
-- database cannot tell an admin acting as herself from an admin acting as a
-- weaver; only the application knows which cookie was set.
--
-- Which is exactly why this table exists. An audit trail is the compensating
-- control for a capability the database cannot scope: every session is logged
-- with who, whom and when, and the log is append-only for the person writing
-- it. Nobody can look at a weaver's screen without leaving a row behind.
-- =============================================================================

create table impersonation_log (
  id            uuid        primary key default gen_random_uuid(),

  admin_user_id uuid        not null references app_users (id),
  vendor_id     uuid        not null references vendors (id),

  started_at    timestamptz not null default now(),
  -- Null while a session is open. Written when she stops, or left null when she
  -- simply closes the tab — which is the common case and not worth a heartbeat.
  ended_at      timestamptz
);

create index impersonation_log_vendor_idx on impersonation_log (vendor_id, started_at desc);
create index impersonation_log_admin_idx  on impersonation_log (admin_user_id, started_at desc);

comment on table impersonation_log is
  'Every time a Nerige admin opened a vendor portal as that vendor. Append-only from the application; the compensating control for a capability RLS cannot scope.';

-- -----------------------------------------------------------------------------
-- Isolation
-- -----------------------------------------------------------------------------
-- This table carries `vendor_id`, so the isolation suite's discovery finds it
-- automatically and holds it to the same standard as `products` and `orders`: a
-- vendor session reads her own rows and zero of anyone else's.
--
-- The first draft gave weavers no select policy at all, on the reasoning that
-- whether Nerige looked at her screen is not something the portal owes her
-- mid-order. The suite rejected it — "sees 0, owns 1" — and the suite was
-- right. A vendor-scoped table nobody can read is a table whose isolation is
-- never actually exercised: the leak assertion passes because the answer is
-- always zero, and it would go on passing if the policy were deleted.
--
-- So she can read her own. Nothing renders it, and the transparency is
-- defensible on its own terms — it is a log of someone at Nerige looking at her
-- portal, and she is the other party to that.
alter table impersonation_log enable row level security;
alter table impersonation_log force row level security;

create policy impersonation_log_select_internal on impersonation_log
  for select to authenticated
  using ((select app.is_internal()));

create policy impersonation_log_select_own on impersonation_log
  for select to authenticated
  using (vendor_id = (select app.current_vendor_id()));

-- Insert only, and only as yourself. An admin cannot write a row claiming
-- somebody else did the looking.
create policy impersonation_log_insert_internal on impersonation_log
  for insert to authenticated
  with check ((select app.is_internal()) and admin_user_id = (select auth.uid()));

create policy impersonation_log_close_own on impersonation_log
  for update to authenticated
  using      ((select app.is_internal()) and admin_user_id = (select auth.uid()))
  with check ((select app.is_internal()) and admin_user_id = (select auth.uid()));

grant select, insert, update on impersonation_log to authenticated;

-- -----------------------------------------------------------------------------
-- vendor_summary — the numbers the "My vendors" screen is made of
-- -----------------------------------------------------------------------------
-- Counting designs off `vendor_collections` would be wrong in a way nobody
-- would notice: that view is grouped by collection and excludes rows where
-- `collection is null`, so a weaver with uncategorised designs would be shown a
-- total lower than her actual catalogue. This counts `products` directly.
--
-- Open orders means issued or accepted — the two states where Nerige is waiting
-- on her. Dispatched is her part finished.
--
-- `security_invoker = true`, like every other view here: it inherits
-- `products_select_own` and `orders_select_own` rather than bypassing them, so
-- a vendor session reading this view sees exactly her own row. The isolation
-- suite discovers it by its `vendor_id` column and asserts that.
create view vendor_summary
with (security_invoker = true) as
  select
    v.id                                                              as vendor_id,
    (select count(*) from products p where p.vendor_id = v.id)::integer
                                                                      as design_count,
    (select count(*) from products p
      where p.vendor_id = v.id and p.qty_available in (0, 1))::integer
                                                                      as reorder_count,
    (select count(*) from orders o
      where o.vendor_id = v.id and o.status in ('issued', 'accepted'))::integer
                                                                      as open_order_count,
    (select max(o.issued_at) from orders o where o.vendor_id = v.id)  as last_order_at
  from vendors v
 where v.deleted_at is null;

grant select on vendor_summary to authenticated;

comment on view vendor_summary is
  'Per-vendor catalogue size, reorder pool size and open order count. security_invoker: inherits the products and orders policies rather than bypassing them.';
