-- =============================================================================
-- 009 — vendor_facets: the filters on the weaver's catalogue
-- =============================================================================
-- The catalogue now opens on every design rather than on a list of collections,
-- so it needs something to narrow WITH. Narrowing is by collection, colour or
-- fabric, and each needs the same two things: which values this weaver actually
-- has, and how many designs sit behind each — a dropdown listing colours she
-- has never woven is worse than no dropdown.
--
-- PostgREST cannot express GROUP BY over a table, and three separate views
-- would be three grants, three policies to keep in step and three objects for
-- the isolation suite to discover. One view with a `facet` discriminator is a
-- single object with a single grant.
--
-- HDR alone has 19 collections, 81 colours and 11 fabrics over 2,365 designs,
-- which is exactly why this is a view and not a client-side count over every
-- row.
--
-- `security_invoker = true` is the whole security of this object.
--
-- A view without it runs as its OWNER, so the `products` policies are evaluated
-- against the owner rather than the caller, and every weaver would see every
-- other weaver's colours and collections through it. With it, the view is
-- transparent: `products_select_own` applies exactly as it does to a direct
-- query, and a vendor session reads only her own facets. The isolation suite
-- discovers this view from the catalog by its `vendor_id` column and asserts
-- precisely that.
-- =============================================================================

create view vendor_facets
with (security_invoker = true) as
  select
    p.vendor_id,
    'collection'::text        as facet,
    p.collection              as value,
    count(*)::integer         as design_count
  from products p
  where p.collection is not null
  group by p.vendor_id, p.collection

  union all

  select
    p.vendor_id,
    'colour'::text,
    p.colour_code,
    count(*)::integer
  from products p
  where p.colour_code is not null
  group by p.vendor_id, p.colour_code

  union all

  select
    p.vendor_id,
    'fabric'::text,
    p.fabric,
    count(*)::integer
  from products p
  where p.fabric is not null
  group by p.vendor_id, p.fabric;

grant select on vendor_facets to authenticated;

comment on view vendor_facets is
  'Per-vendor collection, colour and fabric values with design counts, for the catalogue filters. security_invoker: inherits the products policies rather than bypassing them.';
