-- =============================================================================
-- 029 — Oversold is sold out, and Shopify was already telling us so
-- =============================================================================
-- Migration 023 justified two stock columns on this claim:
--
--   "Shopify's on-hand does not net out reserved stock the way EasyEcom's
--    Available does"
--
-- That is false, and migration 027 repeated it. Checked against this shop's own
-- API on 2026-08-19, `ProductVariant.inventoryQuantity` — the field the sync has
-- read since the day it was written — is exactly Shopify's `available`, and
-- `available = on_hand - committed`:
--
--   NRG-GEN-XX-XX-6687   inventoryQuantity -118   on_hand  50   committed 168
--   TT-VINT-COT-GRN-9590 inventoryQuantity   67   on_hand  93   committed  26
--   SNM-GEN-COT-BLK-8057 inventoryQuantity   12   on_hand  71   committed  59
--
-- So the number already excludes pieces owed to open customer orders, which is
-- the whole property EasyEcom's Available was wanted for. The columns 023 added
-- are not wrong to exist — a second independent source is still worth having —
-- but the reason given for them was.
--
-- WHAT THAT MAKES NEGATIVE STOCK. Not a glitch, and not a number to clamp: -118
-- means 168 pieces are owed against 50 held. One hundred and eighteen customers
-- have paid for a saree that does not exist yet. It is the strongest possible
-- signal to ask a weaver to make more.
--
-- And it was excluded from the reorder pool. `qty_available in (0, 1)` matches
-- zero and one and nothing below, so the designs in the deepest deficit — 27 of
-- them, one having sold 626 pieces in ninety days — were the only ones the
-- reorder grid could not show. The pool inverted exactly where it mattered
-- most.
--
-- The predicate becomes `<= 1` everywhere it appears: one partial index for the
-- browse path, three for the sort ladder, two views, and the order-issuing
-- function. It is not enough to fix the query in /reorder — a partial index
-- whose WHERE clause is narrower than the query's simply stops being used, and
-- the grid would silently fall back to a sequential scan over ten thousand rows.
--
-- WHY 'sold_out' RATHER THAN A NEW REASON. `order_lines.reorder_reason` is
-- CHECKed against ('sold_out', 'last_piece'), and a saree at -118 is sold out —
-- emphatically. A third value would mean a constraint change, a translation in
-- five languages, and a new word on a purchase order a weaver reads, to express
-- something the quantity beside it already says. If that turns out to be worth
-- distinguishing later, it is an additive change.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- The four partial indexes
-- -----------------------------------------------------------------------------
drop index if exists products_reorder_pool_idx;
create index products_reorder_pool_idx
  on products (vendor_id, collection, seq desc)
  where qty_available <= 1;

drop index if exists products_reorder_tier_30_idx;
drop index if exists products_reorder_tier_60_idx;
drop index if exists products_reorder_tier_90_idx;

create index products_reorder_tier_30_idx
  on products (vendor_id, tier_30, units_30d desc) where qty_available <= 1;
create index products_reorder_tier_60_idx
  on products (vendor_id, tier_60, units_60d desc) where qty_available <= 1;
create index products_reorder_tier_90_idx
  on products (vendor_id, tier_90, units_90d desc) where qty_available <= 1;

-- -----------------------------------------------------------------------------
-- The two views that count the pool
-- -----------------------------------------------------------------------------
-- Recreated whole rather than patched, and `security_invoker` restated on each:
-- omitting it would silently turn a policy-inheriting view into one that runs as
-- its owner, which is the most common way an otherwise well-policied Postgres
-- schema leaks. The isolation suite discovers both by their vendor_id column and
-- asserts a weaver sees only her own rows.
create or replace view vendor_collections
with (security_invoker = true) as
select
  p.vendor_id,
  p.collection,
  count(*)::integer                                          as design_count,
  count(*) filter (where p.qty_available <= 1)::integer       as reorder_count,
  max(p.stock_synced_at)                                     as stock_synced_at
from products p
where p.collection is not null
group by p.vendor_id, p.collection;

create or replace view vendor_summary
with (security_invoker = true) as
  select
    v.id                                                              as vendor_id,
    (select count(*) from products p where p.vendor_id = v.id)::integer
                                                                      as design_count,
    (select count(*) from products p
      where p.vendor_id = v.id and p.qty_available <= 1)::integer
                                                                      as reorder_count,
    (select count(*) from orders o
      where o.vendor_id = v.id and o.status in ('issued', 'accepted'))::integer
                                                                      as open_order_count,
    (select max(o.issued_at) from orders o where o.vendor_id = v.id)  as last_order_at
  from vendors v
 where v.deleted_at is null;

-- -----------------------------------------------------------------------------
-- The reason written onto an order line
-- -----------------------------------------------------------------------------
-- Rewritten in place from the function's own current definition, so this cannot
-- drift from whatever `issue_orders` says by the time it runs — the same
-- technique migration 025 used on the sync guards, and for the same reason.
--
-- `when 0` becomes `when qty_available <= 0`, so an oversold design is labelled
-- sold_out rather than falling through the CASE to NULL. A NULL there is not
-- cosmetic: `order_lines` CHECKs that a restock line HAS a reason.
do $$
declare
  v_def text;
  v_new text;
begin
  v_def := pg_get_functiondef(to_regprocedure('public.issue_orders(jsonb)'));

  v_new := replace(
    v_def,
    'case p.qty_available when 0 then ''sold_out'' when 1 then ''last_piece'' else null end',
    'case when p.qty_available <= 0 then ''sold_out'' when p.qty_available = 1 then ''last_piece'' else null end'
  );

  if v_new = v_def then
    raise exception 'issue_orders no longer contains the expected reorder_reason CASE; migration 029 needs updating.';
  end if;

  execute v_new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Say what the column is, correctly this time
-- -----------------------------------------------------------------------------
comment on column products.qty_available is
  'Shopify''s AVAILABLE quantity, from ProductVariant.inventoryQuantity — verified 2026-08-19 to equal on_hand minus committed, so it already excludes pieces owed to open customer orders. Goes negative when a design oversells: -118 means 118 more are owed than exist. Drives the reorder pool (`<= 1`) and the sell-through denominator.';

comment on column products.shopify_qty_available is
  'Dormant. Migration 023 added this believing qty_available held EasyEcom''s Available and Shopify''s a different figure; both are Shopify''s available today. Kept as the destination if a second, independent stock source is ever wired, at which point stock_variance becomes meaningful.';
