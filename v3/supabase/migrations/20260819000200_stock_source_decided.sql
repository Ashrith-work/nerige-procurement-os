-- =============================================================================
-- 027 — Shopify is the stock figure, decided
-- =============================================================================
-- Migration 023 declared `products.qty_available` to be EasyEcom's *Available*
-- and added `shopify_qty_available` as the correct destination for Shopify's
-- number. `sync_upsert_products` has always written Shopify's inventoryQuantity
-- straight into `qty_available`, and `sync-products.ts` says it does that on
-- purpose — "until that endpoint is wired, Shopify's is what there is".
--
-- Both were right when written and together they were a contradiction: the
-- column's comment said one thing and the only code that fills it did another.
-- After the first full sync that contradiction had a cost — `shopify_qty_
-- available` was NULL on all 10,149 rows, `stock_variance` was inert, and
-- nobody reading the schema could tell which system the reorder pool was
-- actually running on.
--
-- DECIDED 2026-08-19: Shopify's Available is the stock figure, for the reorder
-- pool and for sell-through, and EasyEcom is not consulted. This migration
-- changes no data and no behaviour. It changes what the schema SAYS, so that
-- the next person to read it is told the truth.
--
-- WHAT IS GIVEN UP BY DECIDING THIS WAY, stated plainly so it is a decision and
-- not an accident:
--
--   * Shopify's on-hand does not net out pieces reserved against open customer
--     orders. A design with two left and both already sold reads 2, and the
--     reorder pool predicate `qty_available in (0, 1)` will not see it. It
--     becomes visible only once those orders ship.
--   * Shopify's on-hand goes NEGATIVE when a design oversells. 27 currently
--     are, one at -117 having sold 250 pieces in thirty days. Negative is not
--     in `(0, 1)` either, so the best-selling sold-out designs sit OUTSIDE the
--     reorder pool — the opposite of what the pool is for. See below.
--
-- The alternative was to leave the reorder pool empty until EasyEcom
-- credentials arrive, which is not a better answer: an empty pool is not more
-- correct than an approximate one, it is just unusable.
--
-- The 023 columns stay exactly as they are. `shopify_qty_available`,
-- `reserved_qty` and the generated `stock_variance` cost nothing while unused
-- and are the shape this takes when EasyEcom does arrive: at that point
-- `qty_available` becomes EasyEcom's again, Shopify's moves into the column
-- that bears its name, and the variance between them becomes the signal 023
-- described. Nothing here forecloses that.
-- =============================================================================

comment on column products.qty_available is
  'Stock on hand, from Shopify''s variant inventoryQuantity — decided 2026-08-19 (migration 027). Does NOT net out pieces reserved against open orders, and goes negative on an oversold design. Drives the reorder pool (`in (0, 1)`) and the sell-through denominator. When EasyEcom is wired this column becomes its Available figure and Shopify''s moves to shopify_qty_available; see migration 023.';

comment on column products.shopify_qty_available is
  'Dormant until EasyEcom is wired. Today Shopify''s figure lives in qty_available (migration 027), so this is NULL on every row and stock_variance with it. Kept because it is where Shopify''s number moves the moment there is a second opinion to compare it against.';

comment on column products.reserved_qty is
  'Dormant. EasyEcom owns this number and nothing else may write it — a Shopify sync filling it in would be inventing a figure, which is precisely the error stock_variance exists to catch.';

-- -----------------------------------------------------------------------------
-- The oversold, made findable
-- -----------------------------------------------------------------------------
-- Not a fix — changing the reorder predicate is a product decision, not a
-- schema one, and `in (0, 1)` is written into the pool index, vendor_facets and
-- issue_orders alike. This only makes the affected designs cheap to list, so
-- the decision can be taken against real rows rather than in the abstract.
--
-- Partial, because oversold is rare by construction: 27 rows out of 10,149, and
-- indexing the other 10,122 to find them would be waste.
create index if not exists products_oversold_idx
  on products (qty_available, units_30d desc)
  where qty_available < 0;

comment on index products_oversold_idx is
  'Designs Shopify reports as oversold. They are sold out and in demand, yet fall outside the reorder pool because a negative quantity is not in (0, 1).';
