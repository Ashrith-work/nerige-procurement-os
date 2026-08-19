-- =============================================================================
-- 020 — Three more roles
-- =============================================================================
-- This migration does one thing and does it alone, for a reason that is easy to
-- trip over: PostgreSQL permits `ALTER TYPE ... ADD VALUE` inside a transaction
-- but forbids *using* the new value in that same transaction. Supabase wraps
-- each migration file in one transaction. A single file that added these values
-- and then wrote a policy referencing them would fail with
--
--   unsafe use of new value "admin" of enum type app_role
--
-- so the values land here and everything that uses them lands in 021.
--
-- `warehouse_manager` is a RETURNING role. Migration 001 records that the
-- previous build carried it for goods receipt, and that this build dropped it
-- because "both of those workflows are out of scope, so both roles would be
-- unreachable". It comes back with a reachable workflow behind it — product
-- intake — which is the bar that comment set. Goods receipt remains out of
-- scope; if it arrives later it arrives as its own module.
--
-- What each role is for:
--
--   admin              The owner. Every capability, and the only role permitted
--                      to correct anything a customer can already see.
--   procurement_head   Unchanged. Reorder, orders, approval, sync.
--   warehouse_manager  Submits new sarees and tracks them. That is the whole of
--                      the job in this system.
--   customer_support   Reads. Looks up a product to answer a question. Writes
--                      nothing, anywhere.
--   vendor             Unchanged. The weaver.
-- =============================================================================

alter type app_role add value if not exists 'admin';
alter type app_role add value if not exists 'warehouse_manager';
alter type app_role add value if not exists 'customer_support';

-- Note for whoever reads this next: the existing constraints on app_users
-- already do the right thing for all three. `app_users_internal_needs_email`
-- is `role = 'vendor' or email is not null`, so every new role requires an
-- email; `app_users_vendor_needs_phone` is `role <> 'vendor' or phone is not
-- null`, so none of them requires a phone. Neither needed changing.
