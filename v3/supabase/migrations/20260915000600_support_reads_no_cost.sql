-- =============================================================================
-- 037 — Customer support stops reading intake cost prices
-- =============================================================================
-- Migration 022 let every staff role read `product_intakes`, on the reasoning
-- that support answering "where is this saree" must be able to look anything
-- up. That reasoning was sound and the grant was wider than it: Postgres has no
-- column-level RLS, so a row support may see is a row whose `cost_price` and
-- `mrp` support may see, and every login reaches the database as the same
-- `authenticated` role, so a column grant cannot tell support from Pooja.
--
-- The lookup built in 036 no longer needs the table at all. `lookup_product()`
-- is SECURITY DEFINER and names the columns it returns — intake status, code,
-- SKU — and cost is not among them. So support's direct read is removed and
-- the lookup keeps working.
--
-- The other three staff roles keep the read exactly as 022 wrote it: the
-- warehouse manager submits these rows, and admin and procurement price them.
-- =============================================================================

drop policy if exists product_intakes_staff_read on product_intakes;

create policy product_intakes_staff_read on product_intakes
  for select to authenticated
  using (
    (select app.is_staff())
    and (select app.current_role()) <> 'customer_support'
  );

comment on policy product_intakes_staff_read on product_intakes is
  'Staff other than customer_support. Support reads intake status through lookup_product(), which does not return cost.';
