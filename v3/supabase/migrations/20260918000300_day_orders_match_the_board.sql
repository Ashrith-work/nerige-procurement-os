-- =============================================================================
-- 041 — "Open" means on the day sheet what it means on the dispatch board
-- =============================================================================
-- Migration 039 counted an order as open unless `dispatch.order_state` said
-- shipped. On the live database that produced **2,035 open orders and an oldest
-- of 14 July 2025** on a warehouse that is not two thousand orders behind: the
-- board records a shipment only when somebody works an order through it, and
-- almost every order in the mirror was fulfilled in Shopify instead.
--
-- The board itself has never had this problem, because it does not ask that
-- question of `order_state` alone. Its rule (nerige-dispatch, queries.ts,
-- OPEN_SQL) is:
--
--     not cancelled, not digital, not shipped or cancelled here, AND NOT
--     (fulfilled in Shopify with proof — tracking, an offline sale, or a
--     Porter run) ... unless delivery has been attempted and failed, or
--     somebody here has picked, packed or held it, because a person's own
--     record must not be overruled by a Shopify flag.
--
-- That rule is reproduced below, verbatim in meaning. The day sheet and the
-- board are two windows onto one warehouse, and a number that disagrees
-- between them is worse than no number: whoever notices has to work out which
-- screen is lying, and until then both are suspect.
--
-- WHAT "WENT OUT TODAY" MEANS, for the same reason: proof of shipment dated
-- today — a fulfillment with a tracking number — or the board's own shipped_at.
-- Counting only the latter reported zero dispatches on a day the warehouse
-- shipped twenty-one orders.
-- =============================================================================

create or replace function public.warehouse_day_orders(p_date date)
returns table (
  orders_received     integer,
  domestic            integer,
  international       integer,
  saree_only          integer,
  service_orders      integer,
  stitched_orders     integer,
  offline_orders      integer,
  can_ship_today      integer,
  dispatched          integer,
  still_to_go         integer,
  open_till_date      integer,
  oldest_open         date,
  board_connected     boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_has_dispatch boolean;
begin
  -- `app.is_staff()` deliberately excludes the developer (migration 033 keeps
  -- that role out of every capability and gives it a blanket SELECT instead).
  -- Admitting it by name keeps view-as honest: a developer checking this screen
  -- must see the orders half as the manager sees it, and this returns counts
  -- only.
  if not ((select app.is_staff()) or (select app.is_developer())) then
    raise exception 'The day sheet is for Nerige staff.' using errcode = 'insufficient_privilege';
  end if;

  select exists (
    select 1 from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'dispatch' and c.relname = 'orders'
  ) into v_has_dispatch;

  if not v_has_dispatch then
    return query select 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, null::date, false;
    return;
  end if;

  return query execute $q$
    with placed as (
      select o.*
        from dispatch.orders o
       where o.placed_at::date = $1
         and o.cancelled_at is null
    ),
    -- The board's own definition of an order still needing the warehouse.
    open_orders as (
      select o.shopify_order_id, o.placed_at::date as placed_on
        from dispatch.orders o
        left join dispatch.order_state s on s.shopify_order_id = o.shopify_order_id
       where o.placed_at::date <= $1
         and o.cancelled_at is null
         and o.stream <> 'digital'
         and coalesce(s.status::text, 'pending') not in ('shipped', 'cancelled')
         and (
           not (
             o.shopify_fulfillment_status = 'FULFILLED'
             and (o.tracking_count > 0 or o.is_offline or coalesce(o.porter_requested, false))
           )
           or o.delivery_status in ('ATTEMPTED_DELIVERY', 'DELAYED')
           or coalesce(s.status::text, 'pending') in ('picked', 'packed', 'on_hold')
         )
    ),
    -- Proof that something left the building on this day: a fulfillment with a
    -- tracking number, or the board's own record of shipping it.
    gone_today as (
      select distinct o.shopify_order_id
        from dispatch.orders o
        left join dispatch.order_state s on s.shopify_order_id = o.shopify_order_id
        left join dispatch.fulfillments f
               on f.shopify_order_id = o.shopify_order_id
              and f.created_at::date = $1
              and coalesce(f.status, '') <> 'CANCELLED'
              and coalesce(f.tracking_number, '') <> ''
       where s.shipped_at::date = $1
          or f.fulfillment_id is not null
    )
    select
      (select count(*) from placed)::integer,
      (select count(*) from placed where lane = 'domestic')::integer,
      (select count(*) from placed where lane = 'international')::integer,
      (select count(*) from placed where stream = 'saree')::integer,
      (select count(*) from placed where stream = 'service')::integer,
      (select count(*) from placed where stream = 'stitched')::integer,
      (select count(*) from placed where is_offline)::integer,
      (select count(*) from placed
        where not needs_address and dispatch_open_at::date <= $1)::integer,
      (select count(*) from gone_today)::integer,
      -- Of what was taken today, what is still here.
      (select count(*) from placed p
        where exists (select 1 from open_orders w where w.shopify_order_id = p.shopify_order_id))::integer,
      (select count(*) from open_orders)::integer,
      (select min(placed_on) from open_orders),
      true
  $q$ using p_date;
end;
$$;

comment on function public.warehouse_day_orders(date) is
  'The orders half of the day sheet, counted with the dispatch board''s own definition of open (nerige-dispatch queries.ts OPEN_SQL). Counts only: no order number, customer or address crosses this boundary.';
