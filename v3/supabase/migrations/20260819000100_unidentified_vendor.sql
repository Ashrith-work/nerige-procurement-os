-- =============================================================================
-- 026 — A saree whose SKU names no weaver
-- =============================================================================
-- The first full sync, 2026-08-19, created 152 vendors. 100 of them are not
-- weavers. They are stock numbers.
--
-- `vendorCodeFromSku` splits a SKU on '-' and takes segment one. That is right
-- for `PGW-BRHM-SLK-CRM-5855` and wrong for `VINTWB14700`, which has no hyphen
-- at all: segment one is the ENTIRE SKU, it satisfies the vendor code CHECK
-- (eleven characters, starts with a letter), and `sync_upsert_products` duly
-- minted a vendor called VINTWB14700 owning exactly one product called
-- VINTWB14700. A hundred times over. 103 vendors hold a single product; three
-- of those are real.
--
-- WHY NOT SIMPLY SKIP THESE ROWS. The sync already has a skip path for a prefix
-- that fails the vendor pattern, and reaching for it here would drop 100 real,
-- sellable sarees out of the catalogue entirely — invisible to /reorder, absent
-- from the intake vocabulary, missing from every count. The product is not
-- defective; only our knowledge of who made it is. So the row is kept and the
-- missing fact is made explicit and assignable.
--
-- WHY A PLACEHOLDER VENDOR RATHER THAN A NULLABLE vendor_id. `products.
-- vendor_id` is NOT NULL, and every vendor-facing RLS policy, the reorder
-- index, `vendor_facets` and `vendor_summary` all join through it. Making it
-- nullable to model "unknown" would weaken a column that eleven migrations of
-- isolation depend on, in order to record a fact about 100 rows. A row that
-- points at a vendor nobody can sign in as is already invisible to every
-- weaver — exactly the required behaviour — and it gets there without touching
-- a single policy.
--
-- The placeholder is NOT a weaver and must never be offered as one. That is
-- what `is_placeholder` is for: an honest predicate for the intake dropdown and
-- the vendor list to exclude, rather than overloading `status = 'archived'`,
-- which means "a weaver we no longer work with" and would put this row in front
-- of anyone reviewing dormant suppliers.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- The flag
-- -----------------------------------------------------------------------------
alter table vendors
  add column if not exists is_placeholder boolean not null default false;

comment on column vendors.is_placeholder is
  'True only for the holding pen that owns products whose SKU names no weaver. Never a real supplier: exclude from vendor pickers, supplier reports and anything that counts weavers.';

-- One holding pen, not several. Without this a second could be created by hand
-- and the products would silently split across two queues, each looking empty.
create unique index if not exists vendors_one_placeholder
  on vendors ((true)) where is_placeholder;

-- -----------------------------------------------------------------------------
-- The holding pen itself
-- -----------------------------------------------------------------------------
-- `on_hold` rather than `active`: nothing should ever raise a purchase order
-- against it, and `archived` would read as a weaver we have stopped using.
insert into vendors (code, display_name, status, is_placeholder)
select 'UNIDENTIFIED', 'To be identified', 'on_hold', true
 where not exists (select 1 from vendors where is_placeholder);

-- -----------------------------------------------------------------------------
-- Repair: move the hundred, then remove the vendors invented for them
-- -----------------------------------------------------------------------------
-- Narrow on purpose. The predicate is not "a vendor with one product" — three
-- real weavers look like that — it is "a vendor whose code IS a product's SKU,
-- and that SKU has no hyphen". Only the defect described above produces that
-- coincidence.
with placeholder as (
  select id from vendors where is_placeholder
),
invented as (
  select v.id
    from vendors v
    join products p on p.sku = v.code
   where position('-' in p.sku) = 0
     and not v.is_placeholder
)
update products p
   set vendor_id = (select id from placeholder)
  from invented i
 where p.vendor_id = i.id;

-- Soft, not hard. `app.forbid_hard_delete` sits on this table and refuses a
-- DELETE outright — a rule worth keeping even for rows that should never have
-- existed, because "this vendor was invented by a sync on 2026-08-19 and
-- retired the same day" is a more useful thing to be able to read later than a
-- gap. Setting deleted_at also frees the code: the unique index on `code` is
-- partial on `deleted_at is null`, so if VINTWB14700 ever turns out to be a
-- real weaver the name is available again.
--
-- Safe only because these carry nothing: verified zero vendor_users, zero
-- orders and zero vendor_collections before this was written, and the NOT
-- EXISTS clauses re-verify it at run time rather than trusting that survey. A
-- vendor that has acquired any of them since is left alone, and shows up as a
-- leftover rather than being retired along with its history.
update vendors v
   set deleted_at = now(),
       status     = 'archived'
 where not v.is_placeholder
   and v.deleted_at is null
   and exists (select 1 from products p where p.sku = v.code and position('-' in p.sku) = 0)
   and not exists (select 1 from products           p  where p.vendor_id  = v.id)
   and not exists (select 1 from vendor_users       vu where vu.vendor_id = v.id)
   and not exists (select 1 from orders             o  where o.vendor_id  = v.id)
   and not exists (select 1 from vendor_collections vc where vc.vendor_id = v.id);

-- -----------------------------------------------------------------------------
-- The sync stops inventing weavers
-- -----------------------------------------------------------------------------
-- Two changes, both inside the same function:
--
--   * vendors are created only from a vendor_code the caller could actually
--     derive — the application now sends NULL rather than a stock number;
--   * the join that resolves vendor_id becomes a LEFT JOIN falling back to the
--     placeholder, so a row with no derivable vendor is WRITTEN rather than
--     silently dropped.
--
-- That second point is the one worth guarding. The previous INNER join meant a
-- vendor_code with no matching vendor row made the product vanish from the
-- result set with no error and no count. Anything unresolved now lands in the
-- holding pen, where a human can see it.
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
  v_changed     integer;
  v_placeholder uuid;
begin
  if not (select app.is_sync_principal()) then
    raise exception 'Only the Nerige team can run a sync.'
      using errcode = 'insufficient_privilege';
  end if;

  select id into v_placeholder from public.vendors where is_placeholder;
  if v_placeholder is null then
    raise exception 'No placeholder vendor exists; migration 026 did not run.';
  end if;

  -- Vendors first. The SKU prefix IS the vendor (spec §2), so a prefix nobody
  -- has seen before is a new weaver — created with the code as her name until
  -- somebody edits it. A NULL vendor_code is not a new weaver; it is a SKU that
  -- names none, and inventing one from it is the defect this migration repairs.
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
    select i.*, coalesce(v.id, v_placeholder) as vendor_id
      from incoming i
      left join public.vendors v
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
      -- An identification, once made, is a human decision and outranks the
      -- sync — the same protection migration 017 gave manual_image_url. The SKU
      -- shape never changes, so the sync would go on sending the placeholder
      -- for VINTWB14700 forever and undo the admin's work every half hour.
      --
      -- So the sync may move a product OUT of the holding pen, never back into
      -- it: it wins only while the product is still unassigned.
      vendor_id          = case
                             when excluded.vendor_id = v_placeholder
                               then public.products.vendor_id
                             else excluded.vendor_id
                           end,
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
                             public.products.manual_image_url,
                             excluded.display_image_url
                           ),
      is_active          = true,
      stock_synced_at    = excluded.stock_synced_at,
      last_synced_at     = excluded.last_synced_at
    returning 1
  )
  select count(*)::integer into v_changed from upserted;

  return coalesce(v_changed, 0);
end;
$$;

comment on function public.sync_upsert_products(jsonb, timestamptz) is
  'Upserts one chunk of a Shopify sync. Creates vendors only from a derivable SKU prefix, parks the rest with the placeholder vendor for manual identification, discovers collection/fabric/colour codes into master_data, and never overwrites a manual image override, an identified vendor, or a stock figure owned by another system.';

-- -----------------------------------------------------------------------------
-- Assigning the real weaver
-- -----------------------------------------------------------------------------
-- An RPC rather than a direct UPDATE from the application, for the reason every
-- other write in this schema is one: the predicate "only from the holding pen"
-- has to be enforced where it cannot be forgotten. A plain update statement in
-- a server action is one missing WHERE clause away from reassigning a product
-- that already belongs to a weaver.
create or replace function public.identify_product_vendor(
  p_sku         text,
  p_vendor_code text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vendor      uuid;
  v_placeholder uuid;
  v_current     uuid;
begin
  if not (select app.is_admin()) then
    raise exception 'Only the owner can identify a vendor.'
      using errcode = 'insufficient_privilege';
  end if;

  select id into v_placeholder from public.vendors where is_placeholder;

  select vendor_id into v_current from public.products where sku = p_sku;
  if v_current is null then
    raise exception 'No product with SKU %.', p_sku using errcode = 'no_data_found';
  end if;

  -- Deliberately refuses to re-home a product that already has a weaver. This
  -- screen answers "who made this?", not "move this to somebody else" — that is
  -- a correction, belongs on the product page, and should carry the audit trail
  -- WF5 will give it.
  if v_current <> v_placeholder then
    raise exception 'SKU % already belongs to a weaver.', p_sku
      using errcode = 'check_violation';
  end if;

  select id into v_vendor
    from public.vendors
   where code = p_vendor_code
     and deleted_at is null
     and not is_placeholder;

  if v_vendor is null then
    raise exception 'No weaver with code %.', p_vendor_code
      using errcode = 'foreign_key_violation';
  end if;

  update public.products set vendor_id = v_vendor where sku = p_sku;
end;
$$;

comment on function public.identify_product_vendor(text, text) is
  'Assigns the real weaver to a product sitting in the placeholder holding pen. Admin only, and refuses any product that already has a vendor.';

revoke all on function public.identify_product_vendor(text, text) from public, anon;
grant execute on function public.identify_product_vendor(text, text) to authenticated;
