-- =============================================================================
-- 023 — Two stock numbers, side by side
-- =============================================================================
-- `products.qty_available` is documented as EasyEcom's *Available* — the figure
-- that excludes stock reserved against open customer orders — and it is the
-- entire reorder-pool predicate: `qty_available in (0, 1)`.
--
-- The temptation, once Shopify is connected live, is to point that column at
-- Shopify's inventory and be done. That would be a quiet mistake. Shopify's
-- on-hand does not net out reserved stock the way EasyEcom's Available does, so
-- repointing the column would change WHICH SAREES A WEAVER IS ASKED TO MAKE
-- AGAIN — the heart of the product — as a side effect of an integration.
--
-- So both numbers are kept, and the gap between them becomes the useful signal.
-- A saree reading 3 in Shopify and 0 in EasyEcom is oversold, or mis-picked, or
-- has a sync that stopped. Today nobody could tell which, because there is only
-- one number and it looks authoritative either way.
--
-- EasyEcom keeps the pool. Shopify is the second opinion.
-- =============================================================================

alter table products
  -- Shopify's own figure. From the `inventory_levels/update` webhook when one
  -- arrives, from the half-hourly sync otherwise.
  add column shopify_qty_available   integer,
  add column shopify_stock_synced_at timestamptz,

  -- EasyEcom's V3 inventory webhook sends `inventory` and `reserved_inventory`
  -- as SEPARATE fields, which is better than the single net number the column
  -- comment on qty_available assumes. Worth storing: 0 available with 20
  -- reserved is a saree selling well, and 0 available with 0 reserved is a
  -- saree that is simply gone. Those are different conversations and the
  -- reorder pool currently cannot tell them apart.
  add column reserved_qty            integer;

-- Separate statement on purpose: a generated column referencing a column added
-- in the same ALTER TABLE is asking the planner to resolve a dependency mid-
-- statement. Splitting removes the question entirely.
--
-- Nullable by construction. NULL means "Shopify has not told us yet", which is
-- not the same as zero — rendering an unknown as a match would defeat the whole
-- point of keeping two numbers.
alter table products
  add column stock_variance integer
    generated always as (shopify_qty_available - qty_available) stored;

comment on column products.shopify_qty_available is
  'Shopify inventory. The second opinion — never the reorder-pool predicate.';
comment on column products.reserved_qty is
  'EasyEcom reserved_inventory: units committed to open orders. Distinguishes "sold out" from "sold through".';
comment on column products.stock_variance is
  'shopify_qty_available - qty_available. Non-zero means one of the two systems is wrong; NULL means Shopify has not reported yet.';

-- The /admin/stock screen: worst disagreement first. Partial, because in a
-- healthy catalogue almost every row is zero and indexing those is waste.
create index products_stock_variance_idx
  on products (abs(stock_variance) desc, sku)
  where stock_variance is not null and stock_variance <> 0;

-- -----------------------------------------------------------------------------
-- The sync must not touch these
-- -----------------------------------------------------------------------------
-- `sync_upsert_products` enumerates the columns it owns in its ON CONFLICT
-- clause, and these three are deliberately not among them — the same protection
-- migration 017 gave manual_image_url, crop_json, display_image_position and
-- crop_mode.
--
-- The reason differs, though, and is worth stating so nobody "fixes" it later:
-- those four are protected because a human decided them. These are protected
-- because they come from a DIFFERENT SOURCE. A Shopify sync writing
-- shopify_qty_available would be correct; a Shopify sync writing reserved_qty
-- would be inventing a number EasyEcom owns, and the variance column exists to
-- catch exactly that kind of error rather than to commit it.
--
-- No change to the RPC is required today — a column it does not name is a
-- column it does not write. This comment exists so that the next person to add
-- a field to the sync knows which side of the line each column sits on.
