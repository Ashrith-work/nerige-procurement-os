-- =============================================================================
-- 024 — The sync learns to read a SKU
-- =============================================================================
-- `sync_upsert_products` has never written `collection`, `fabric` or
-- `colour_code`. Those three columns are absent from its insert and from its
-- ON CONFLICT clause entirely; they are populated only by the CSV seed loader.
--
-- So every product that has ever arrived from Shopify rather than the seed
-- carries `collection = NULL`. That is not cosmetic:
--
--   * /reorder's access path is one vendor, then one collection — the whole
--     point of `products_vendor_collection_seq_idx`. A NULL-collection product
--     is unreachable through the screen Pooja actually uses.
--   * `vendor_facets` and `catalogue_facets` both GROUP BY those columns, so a
--     synced-in product is missing from the browse counts as well.
--
-- The information was there the whole time. `PGW-BRHM-SLK-CRM-5855` is
-- vendor-collection-fabric-colour-seq, and the sync was already splitting off
-- segment one to find the vendor. This reads the other three.
--
-- The same pass discovers the controlled vocabulary. A code found in a SKU is
-- inserted into master_data as `unnamed`; an admin gives it a label once at
-- /admin/master-data and it is never asked about again. What cannot be derived
-- is the label itself — `BRHM` is in the SKU, whether it means "Bridal" or
-- "Brahmin" is not, and guessing would put a wrong word in front of a customer.
-- =============================================================================

create or replace function public.sync_upsert_products(
  p_rows      jsonb,
  p_synced_at timestamptz
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changed integer;
begin
  if not (select app.is_internal()) then
    raise exception 'Only the Nerige team can run a sync.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Vendors first. The SKU prefix IS the vendor (spec §2), so a prefix nobody
  -- has seen before is a new weaver — created with the code as her name until
  -- somebody edits it, because a product that cannot resolve a vendor_id cannot
  -- be written at all and would be silently dropped.
  insert into public.vendors (code, display_name)
  select distinct r.vendor_code, r.vendor_code
    from jsonb_to_recordset(p_rows) as r(vendor_code text)
   where r.vendor_code is not null
  on conflict (code) where deleted_at is null
  do nothing;

  with incoming as (
    select *
      from jsonb_to_recordset(p_rows) as r(
        sku                 text,
        vendor_code         text,
        collection          text,
        fabric              text,
        colour_code         text,
        shopify_product_id  text,
        shopify_variant_id  text,
        title               text,
        description         text,
        product_type        text,
        shopify_status      text,
        price               numeric,
        cost                numeric,
        qty_available       integer,
        image_urls          jsonb,
        display_image_url   text
      )
  ),
  -- The vocabulary, discovered. Only the three types a SKU can carry: vendor
  -- lives in `vendors`, and product_type / pattern / border / pallu have no
  -- code position in the SKU at all, so they are entered by an admin rather
  -- than found here.
  discovered as (
    insert into public.master_data (type, code)
    select distinct t.type::public.master_data_type, t.code
      from incoming i
      cross join lateral (values
        ('collection', i.collection),
        ('fabric',     i.fabric),
        ('colour',     i.colour_code)
      ) as t(type, code)
     where t.code is not null
       and t.code ~ '^[A-Z0-9][A-Z0-9_-]{0,15}$'
    on conflict (type, code) do nothing
    returning 1
  ),
  resolved as (
    select i.*, v.id as vendor_id
      from incoming i
      join public.vendors v
        on v.code = i.vendor_code
       and v.deleted_at is null
  ),
  upserted as (
    insert into public.products (
      sku, vendor_id, shopify_product_id, shopify_variant_id,
      collection, fabric, colour_code,
      title, description, product_type, shopify_status,
      price, cost, qty_available,
      image_urls, display_image_url,
      is_active, stock_synced_at, last_synced_at
    )
    select
      r.sku, r.vendor_id, r.shopify_product_id, r.shopify_variant_id,
      r.collection, r.fabric, r.colour_code,
      r.title, r.description, r.product_type, r.shopify_status,
      r.price, r.cost, coalesce(r.qty_available, 0),
      coalesce(r.image_urls, '[]'::jsonb), r.display_image_url,
      true, p_synced_at, p_synced_at
    from resolved r
    on conflict (sku) do update set
      vendor_id          = excluded.vendor_id,
      shopify_product_id = excluded.shopify_product_id,
      shopify_variant_id = excluded.shopify_variant_id,

      -- COALESCE, not a plain overwrite. A SKU with fewer than five segments —
      -- `DMG - 157` is in the seed data — parses to NULL for all three, and a
      -- straight assignment would erase the values the CSV loader supplied for
      -- exactly those irregular rows. Parsed wins where parsing worked;
      -- otherwise what is already there stands.
      collection         = coalesce(excluded.collection,  public.products.collection),
      fabric             = coalesce(excluded.fabric,      public.products.fabric),
      colour_code        = coalesce(excluded.colour_code, public.products.colour_code),

      title              = excluded.title,
      description        = excluded.description,
      product_type       = excluded.product_type,
      shopify_status     = excluded.shopify_status,
      price              = excluded.price,
      cost               = excluded.cost,
      qty_available      = excluded.qty_available,
      image_urls         = excluded.image_urls,

      -- NOT overwritten, ever: manual_image_url, crop_json,
      -- display_image_position, crop_mode — what a human decided after looking
      -- at the photograph. Nor shopify_qty_available, reserved_qty: those come
      -- from a different source, and the variance column exists to catch a
      -- disagreement between sources rather than to paper over it.
      display_image_url  = coalesce(
                             excluded.image_urls ->> greatest(
                               least(
                                 public.products.display_image_position,
                                 jsonb_array_length(excluded.image_urls)
                               ) - 1,
                               0
                             ),
                             excluded.display_image_url
                           ),

      is_active          = true,
      stock_synced_at    = excluded.stock_synced_at,
      last_synced_at     = excluded.last_synced_at,
      updated_at         = now()
    returning 1
  )
  select count(*)::integer into v_changed from upserted;

  return coalesce(v_changed, 0);
end;
$$;

comment on function public.sync_upsert_products(jsonb, timestamptz) is
  'Upserts one chunk of a Shopify sync. Creates vendors from unseen SKU prefixes, discovers collection/fabric/colour codes into master_data, and never overwrites a manual image override or a stock figure owned by another system.';

-- -----------------------------------------------------------------------------
-- Vocabulary statistics, recomputed rather than accumulated
-- -----------------------------------------------------------------------------
-- Called once at the end of a sync, not per chunk. Counting incrementally would
-- double every figure on the second sync; recomputing from `products` is
-- idempotent and cheap enough at catalogue scale.
--
-- `examples` exists so the naming screen can answer "what is BRHM?" without
-- the admin leaving the page — three real products carrying the code, with
-- their titles.
create or replace function public.refresh_master_data_stats()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not (select app.is_internal()) then
    raise exception 'Only the Nerige team can refresh master data.'
      using errcode = 'insufficient_privilege';
  end if;

  with facts as (
    select t.type::public.master_data_type as type, t.code, p.sku, p.title
      from public.products p
      cross join lateral (values
        ('collection', p.collection),
        ('fabric',     p.fabric),
        ('colour',     p.colour_code)
      ) as t(type, code)
     where t.code is not null
       and p.is_active
  ),
  ranked as (
    select type, code, sku, title,
           row_number() over (partition by type, code order by sku) as rn,
           count(*)    over (partition by type, code)               as n
      from facts
  ),
  agg as (
    select type, code, max(n)::integer as design_count,
           coalesce(
             jsonb_agg(jsonb_build_object('sku', sku, 'title', title)
                       order by sku) filter (where rn <= 3),
             '[]'::jsonb
           ) as examples
      from ranked
     group by type, code
  ),
  updated as (
    update public.master_data m
       set design_count = a.design_count,
           examples     = a.examples,
           updated_at   = now()
      from agg a
     where m.type = a.type
       and m.code = a.code
       and (m.design_count is distinct from a.design_count
            or m.examples is distinct from a.examples)
    returning 1
  )
  select count(*)::integer into v_count from updated;

  return coalesce(v_count, 0);
end;
$$;

comment on function public.refresh_master_data_stats() is
  'Recomputes design_count and examples on master_data from the live catalogue. Idempotent — run it after every sync.';

revoke all on function public.refresh_master_data_stats() from public, anon;
grant execute on function public.refresh_master_data_stats() to authenticated;
