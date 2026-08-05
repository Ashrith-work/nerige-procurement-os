-- =============================================================================
-- 007 — vendor_collections: the catalogue index, and the collection picker
-- =============================================================================
-- "Grouped by collection" needs a GROUP BY, and PostgREST has no way to express
-- one over a table. Both screens that narrow by collection — the weaver's
-- catalogue and Pooja's reorder grid — need the same three numbers, so they
-- share one view rather than each fetching every row and counting in the
-- browser.
--
-- `security_invoker = true` is the whole security of this object.
--
-- A view without it runs as its OWNER, which means the `products` policies are
-- evaluated against the owner rather than the caller — and every weaver would
-- see every other weaver's collections through it. This is the single most
-- common way an otherwise well-policied Postgres schema leaks. With it, the
-- view is transparent: `products_select_own` applies exactly as it does to a
-- direct query.
-- =============================================================================

create view vendor_collections
with (security_invoker = true) as
select
  p.vendor_id,
  p.collection,
  count(*)::integer                                              as design_count,
  count(*) filter (where p.qty_available in (0, 1))::integer     as reorder_count,
  -- Every quantity on screen carries its age, including an aggregated one.
  max(p.stock_synced_at)                                         as stock_synced_at
from products p
where p.collection is not null
group by p.vendor_id, p.collection;

grant select on vendor_collections to authenticated;

comment on view vendor_collections is
  'Per-vendor collection counts for the catalogue index and the reorder picker. security_invoker: inherits the products policies rather than bypassing them.';
