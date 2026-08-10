-- =============================================================================
-- 016 — What actually sold, and the ladder the reorder grid is sorted by
-- =============================================================================
-- `sales_rank` was a nullable integer waiting for an EasyEcom export that never
-- came. This replaces it with the thing itself: units sold per SKU per day,
-- pulled from Shopify's own orders, backfilled 400 days and then incremental.
--
-- WHY DAILY GRAIN AND NOT A RUNNING TOTAL. Because every window is a question
-- somebody will ask later — 30, 60, 90 today; "the fortnight before Ugadi" the
-- moment somebody looks at a chart. A daily row answers all of them from one
-- backfill. A stored 90-day counter answers exactly one and has to be rebuilt
-- from scratch the first time anyone wants a different number.
--
-- WHY THE ROLLUPS ARE STORED ANYWAY. The reorder grid renders 120 tiles and
-- sorts across a vendor's whole pool — 1,660 designs for HDR/VINT alone.
-- Aggregating `sku_sales_daily` per tile, per load, is a group-by over a table
-- with a row per design per day for a year. So the four windows the screen
-- actually offers are denormalised onto `products` at rollup time, and the
-- daily table stays the source they are derived from.
--
-- THE TIER COLUMNS. The sort is a four-rung ladder, then units within a rung:
--
--   1  sold within the selected window
--   2  sold within 365 days but not within the window
--   3  never sold in 365 days, but currently has stock
--   4  never sold in 365 days, no stock
--
-- PostgREST cannot express a CASE in an ORDER BY, and pushing it into a view
-- would mean the window could not be chosen at request time. So the rung is
-- computed per window at rollup and stored — three small integers that turn the
-- whole sort into `order by tier_90, units_90d desc`, which is one index.
--
-- Anything unsold for a year sits at the bottom, which is the point: those are
-- the designs proving they do NOT sell, and they were previously indistinguish-
-- able from a saree that sold out yesterday.
-- =============================================================================

create table sku_sales_daily (
  sku       text        not null references products (sku) on delete cascade,
  date      date        not null,

  units     integer     not null default 0 check (units >= 0),
  -- Distinct orders, not line items. Six of one design in one order is one
  -- customer, and "sold in 12 orders" is a different fact from "sold 12 units".
  orders    integer     not null default 0 check (orders >= 0),
  revenue   numeric(14, 2) not null default 0,

  primary key (sku, date)
);

create index sku_sales_daily_date_idx on sku_sales_daily (date);

comment on table sku_sales_daily is
  'Units, distinct orders and revenue per design per day, from the Shopify orders API. The grain every sales window is derived from.';

-- -----------------------------------------------------------------------------
-- The denormalised windows, on products
-- -----------------------------------------------------------------------------
alter table products
  add column units_30d    integer not null default 0,
  add column units_60d    integer not null default 0,
  add column units_90d    integer not null default 0,
  add column units_365d   integer not null default 0,
  add column revenue_365d numeric(14, 2) not null default 0,
  add column last_sold_at date,

  -- One per selectable window. See the header.
  add column tier_30      smallint not null default 4 check (tier_30 between 1 and 4),
  add column tier_60      smallint not null default 4 check (tier_60 between 1 and 4),
  add column tier_90      smallint not null default 4 check (tier_90 between 1 and 4),

  add column sales_synced_at timestamptz;

comment on column products.tier_90 is
  '1 sold in 90d · 2 sold in 365d but not 90d · 3 unsold in a year but in stock · 4 unsold in a year, no stock. Precomputed so the grid can sort on it.';

-- The exact access path of /reorder with a window chosen: one vendor, the pool,
-- then the ladder. One index per window, each covering the whole sort.
create index products_reorder_tier_30_idx
  on products (vendor_id, tier_30, units_30d desc) where qty_available in (0, 1);
create index products_reorder_tier_60_idx
  on products (vendor_id, tier_60, units_60d desc) where qty_available in (0, 1);
create index products_reorder_tier_90_idx
  on products (vendor_id, tier_90, units_90d desc) where qty_available in (0, 1);

-- -----------------------------------------------------------------------------
-- Isolation
-- -----------------------------------------------------------------------------
-- `sku_sales_daily` carries no vendor_id, and its only NOT NULL foreign key
-- points at `products` — which IS vendor-scoped. So the isolation suite's
-- discovery finds it automatically, one hop out, and builds the predicate
-- `sku in (select sku from products where products.vendor_id = $1)` without
-- anybody adding it to a list. That is exactly the case a hand-written list
-- gets wrong first.
--
-- Which means the policy below has to be right, because it will be tested: a
-- weaver sees sales for her own designs and nobody else's. She should see her
-- own — "36 sold in 90 days" is the badge on her own card, and it is the single
-- most motivating number on the screen.
alter table sku_sales_daily enable row level security;
alter table sku_sales_daily force row level security;

create policy sku_sales_daily_select_internal on sku_sales_daily
  for select to authenticated
  using ((select app.is_internal()));

create policy sku_sales_daily_select_own on sku_sales_daily
  for select to authenticated
  using (
    exists (
      select 1 from products p
       where p.sku = sku_sales_daily.sku
         and p.vendor_id = (select app.current_vendor_id())
    )
  );

grant select on sku_sales_daily to authenticated;

-- -----------------------------------------------------------------------------
-- Writing sales, and rolling them up
-- -----------------------------------------------------------------------------
-- SECURITY DEFINER for the same reason as the product sync: this writes across
-- every vendor, which no policy grants and no weaver may cause.
create or replace function public.sync_upsert_sales(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not (select app.is_internal()) then
    raise exception 'Only the Nerige team can run a sync.'
      using errcode = 'insufficient_privilege';
  end if;

  with incoming as (
    select *
      from jsonb_to_recordset(p_rows) as r(
        sku     text,
        date    date,
        units   integer,
        orders  integer,
        revenue numeric
      )
  ),
  -- Inner join, not left: a line item whose SKU is not in `products` is a
  -- design this portal does not hold — damaged stock sold off, or a product
  -- deleted from Shopify years ago. Inserting it would violate the foreign key
  -- and fail the whole chunk.
  written as (
    insert into public.sku_sales_daily (sku, date, units, orders, revenue)
    select i.sku, i.date, coalesce(i.units, 0), coalesce(i.orders, 0), coalesce(i.revenue, 0)
      from incoming i
      join public.products p on p.sku = i.sku
    on conflict (sku, date) do update set
      -- Replace rather than add. A re-run over the same day must not double it,
      -- and a backfill overlapping an incremental run is the normal case.
      units   = excluded.units,
      orders  = excluded.orders,
      revenue = excluded.revenue
    returning 1
  )
  select count(*)::integer into v_count from written;

  return coalesce(v_count, 0);
end;
$$;

comment on function public.sync_upsert_sales(jsonb) is
  'Writes one chunk of daily sales. Replaces rather than adds, so a backfill overlapping an incremental run is safe.';

/**
 * Recompute every window and every tier, for every design.
 *
 * Whole-table rather than incremental, and that is not laziness: the windows
 * are relative to TODAY, so a design that sold 91 days ago drops out of the
 * 90-day window overnight without any new sales arriving. An incremental
 * rollup touching only SKUs with new rows would leave it in tier 1 forever.
 */
create or replace function public.rollup_sales()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_today date := current_date;
begin
  if not (select app.is_internal()) then
    raise exception 'Only the Nerige team can run a sync.'
      using errcode = 'insufficient_privilege';
  end if;

  with totals as (
    select
      s.sku,
      sum(s.units) filter (where s.date > v_today - 30)  as u30,
      sum(s.units) filter (where s.date > v_today - 60)  as u60,
      sum(s.units) filter (where s.date > v_today - 90)  as u90,
      sum(s.units) filter (where s.date > v_today - 365) as u365,
      sum(s.revenue) filter (where s.date > v_today - 365) as r365,
      max(s.date) filter (where s.units > 0)             as last_sold
    from public.sku_sales_daily s
    group by s.sku
  ),
  updated as (
    update public.products p
       set units_30d    = coalesce(t.u30, 0),
           units_60d    = coalesce(t.u60, 0),
           units_90d    = coalesce(t.u90, 0),
           units_365d   = coalesce(t.u365, 0),
           revenue_365d = coalesce(t.r365, 0),
           last_sold_at = t.last_sold,

           -- The ladder, per window. `qty_available > 1` rather than `> 0`
           -- because the pool is 0 and 1: a design at one piece has effectively
           -- no stock for the purposes of "we still have some of these".
           tier_30 = case
                       when coalesce(t.u30, 0)  > 0 then 1
                       when coalesce(t.u365, 0) > 0 then 2
                       when p.qty_available     > 1 then 3
                       else 4
                     end,
           tier_60 = case
                       when coalesce(t.u60, 0)  > 0 then 1
                       when coalesce(t.u365, 0) > 0 then 2
                       when p.qty_available     > 1 then 3
                       else 4
                     end,
           tier_90 = case
                       when coalesce(t.u90, 0)  > 0 then 1
                       when coalesce(t.u365, 0) > 0 then 2
                       when p.qty_available     > 1 then 3
                       else 4
                     end,

           sales_synced_at = now()
      -- LEFT JOIN semantics via a left-joined subquery: a design with NO sales
      -- rows at all still has to be given a tier, or it keeps the default of 4
      -- even after it starts selling.
      from (select p2.sku from public.products p2) all_skus
      left join totals t on t.sku = all_skus.sku
     where p.sku = all_skus.sku
    returning 1
  )
  select count(*)::integer into v_count from updated;

  return coalesce(v_count, 0);
end;
$$;

comment on function public.rollup_sales() is
  'Recomputes the 30/60/90/365-day windows and the four-rung tier for every design. Whole-table, because the windows move with today.';

revoke all on function public.sync_upsert_sales(jsonb) from public, anon;
revoke all on function public.rollup_sales()           from public, anon;

grant execute on function public.sync_upsert_sales(jsonb) to authenticated;
grant execute on function public.rollup_sales()           to authenticated;
