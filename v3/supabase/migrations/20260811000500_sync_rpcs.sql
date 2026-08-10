-- =============================================================================
-- 015 — The two statements a Shopify sync is made of
-- =============================================================================
-- Both of these could have been written in TypeScript. Neither should be.
--
-- The upsert has to look up a vendor by SKU prefix, create one if it has never
-- been seen, and leave `manual_image_url` and `crop_json` untouched where a
-- human has set them. In application code that is: read every existing row to
-- find the overrides, hold them in memory, write around them — two round trips
-- per chunk of 500 and a race in the gap where an admin saves a crop between
-- the read and the write. `on conflict do update` already expresses all of it
-- atomically, and the database already knows which rows have overrides.
--
-- SECURITY DEFINER with a pinned search_path, and an explicit internal check.
-- These write every vendor's products, which is not a thing any policy grants
-- and not a thing a weaver may ever cause. The check is inside the function
-- rather than left to a grant, so it holds however the function is reached.
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
      title, description, product_type, shopify_status,
      price, cost, qty_available,
      image_urls, display_image_url,
      is_active, stock_synced_at, last_synced_at
    )
    select
      r.sku, r.vendor_id, r.shopify_product_id, r.shopify_variant_id,
      r.title, r.description, r.product_type, r.shopify_status,
      r.price, r.cost, coalesce(r.qty_available, 0),
      coalesce(r.image_urls, '[]'::jsonb), r.display_image_url,
      true, p_synced_at, p_synced_at
    from resolved r
    on conflict (sku) do update set
      vendor_id          = excluded.vendor_id,
      shopify_product_id = excluded.shopify_product_id,
      shopify_variant_id = excluded.shopify_variant_id,
      title              = excluded.title,
      description        = excluded.description,
      product_type       = excluded.product_type,
      shopify_status     = excluded.shopify_status,
      price              = excluded.price,
      cost               = excluded.cost,
      qty_available      = excluded.qty_available,
      image_urls         = excluded.image_urls,

      -- NOT overwritten, ever: manual_image_url, crop_json,
      -- display_image_position, crop_mode. Those four are what a human decided
      -- after looking at the photograph, and a sync every thirty minutes that
      -- undid them would quietly erase an afternoon's work.
      --
      -- display_image_url follows the stored POSITION rather than the incoming
      -- default, so a product whose position was corrected to 5 keeps showing
      -- image 5 after the next sync.
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

      -- Back from the dead: Shopify is returning it again.
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
  'Upserts one chunk of a Shopify sync. Creates vendors from unseen SKU prefixes and never overwrites a manual image override.';

-- -----------------------------------------------------------------------------
-- Retire what Shopify stopped returning
-- -----------------------------------------------------------------------------
-- Marked inactive, never deleted. A product vanishing from a Shopify export is
-- far more often a filter change than a saree that ceased to exist, and
-- deleting it would break every order line pointing at it — including one a
-- weaver is halfway through making.
--
-- Keyed on `last_synced_at` rather than on a diff of id sets, so a row that
-- failed to write for any reason is not retired as a side effect of its own
-- failure.
create or replace function public.sync_deactivate_missing(p_synced_at timestamptz)
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

  with retired as (
    update public.products
       set is_active  = false,
           updated_at = now()
     where is_active
       and (last_synced_at is null or last_synced_at < p_synced_at)
       -- Rows that have never been through a sync are seed data, not products
       -- Shopify dropped. Retiring the entire CSV catalogue the first time a
       -- sync runs against a partial Shopify store would empty every screen.
       and last_synced_at is not null
    returning 1
  )
  select count(*)::integer into v_count from retired;

  return coalesce(v_count, 0);
end;
$$;

comment on function public.sync_deactivate_missing(timestamptz) is
  'Marks products Shopify stopped returning as inactive. Never deletes, and never touches rows that have not been through a sync.';

revoke all on function public.sync_upsert_products(jsonb, timestamptz)  from public, anon;
revoke all on function public.sync_deactivate_missing(timestamptz)      from public, anon;

grant execute on function public.sync_upsert_products(jsonb, timestamptz) to authenticated;
grant execute on function public.sync_deactivate_missing(timestamptz)     to authenticated;
