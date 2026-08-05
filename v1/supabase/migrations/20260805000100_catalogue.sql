-- =============================================================================
-- M2 / 008 — Catalogue: design series and the SKU codes vendors print on labels
-- =============================================================================
-- This migration exists to answer one question the vendor asks every single
-- week, currently over WhatsApp:
--
--     "Which sarees do you buy from me, and what code do I write on each one?"
--
-- Today that code lives in Pooja's head and in a spreadsheet. When a parcel
-- arrives with no code on it, the warehouse has to open every piece and guess.
-- Putting the code in front of the vendor BEFORE they pack is the cheapest
-- possible fix for the inwarding delay — it costs nothing to publish and saves
-- an hour per parcel.
--
-- Two levels, because that is how the business actually talks:
--
--   * a SERIES is a design family — "mustard body, maroon border, gold zari".
--     Pooja commissions a series verbally on the weekly video call; it may not
--     have a single SKU yet.
--   * a PRODUCT is one sellable SKU inside a series, which is what Shopify
--     sells and what the vendor labels.
--
-- Shopify remains the commercial master. Everything here that Shopify also
-- knows (title, image, price, units sold) is a MIRROR — nullable, stamped with
-- a sync time, and never the thing we edit by hand and hope stays true.
-- =============================================================================

-- A series begins life as a request on a call ('proposed'), becomes real when
-- the first pieces arrive, and eventually stops being reordered.
create type series_status as enum (
  'proposed',       -- commissioned on a call; nothing received yet
  'active',         -- in the catalogue, reorderable
  'discontinued'
);

create type product_status as enum (
  'active',         -- reorderable
  'sampling',       -- one-off sample received, not yet a live product
  'discontinued'
);

-- -----------------------------------------------------------------------------
-- product_series
-- -----------------------------------------------------------------------------
-- Vendor-scoped: a series belongs to the vendor who weaves it. Two vendors may
-- both make "mustard with maroon border" and they are not the same series, do
-- not share a code, and must never see each other's version.
create table product_series (
  id            uuid          primary key default gen_random_uuid(),
  vendor_id     uuid          not null references vendors (id) on delete restrict,

  -- The short code that becomes the SKU prefix — 'WB' in shanwb14090. Unique
  -- per vendor, not globally: 'WB' from two vendors is two different series.
  code          text          not null check (code ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,15}$'),
  name          text          not null check (length(trim(name)) between 2 and 120),

  -- The brief as Pooja gave it on the call. Free text on purpose: "mustard body,
  -- maroon border, gold zari, six colour combinations" does not decompose into
  -- columns without losing the part the weaver actually needs.
  description   text,
  status        series_status not null default 'proposed',

  created_by    uuid          references app_users (id),
  created_at    timestamptz   not null default now(),
  updated_at    timestamptz   not null default now(),
  deleted_at    timestamptz,
  version       integer       not null default 1
);

create unique index product_series_code_per_vendor
  on product_series (vendor_id, upper(code)) where deleted_at is null;
create index product_series_vendor_idx
  on product_series (vendor_id) where deleted_at is null;
create index product_series_name_trgm_idx
  on product_series using gin (name gin_trgm_ops);

create trigger product_series_touch
  before update on product_series
  for each row execute function app.touch_row();
create trigger product_series_no_hard_delete
  before delete on product_series
  for each row execute function app.forbid_hard_delete();

comment on table product_series is
  'A design family commissioned from one vendor. Vendor-scoped: the same description from two vendors is two series.';

-- -----------------------------------------------------------------------------
-- products — the SKU the vendor writes on the label
-- -----------------------------------------------------------------------------
create table products (
  id                 uuid           primary key default gen_random_uuid(),
  vendor_id          uuid           not null references vendors (id) on delete restrict,
  series_id          uuid           references product_series (id) on delete restrict,

  -- citext because the existing codes are typed by hand in mixed case
  -- (shanwb14090 / SHANWB14090) and the two must never become two SKUs.
  sku                citext         not null
                                    check (sku ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{1,39}$'),
  title              text           not null check (length(trim(title)) between 2 and 200),

  -- The three attributes a weaver needs to identify a piece by sight. Kept as
  -- plain columns rather than JSON because they are filtered and printed.
  colour             text,
  fabric             text,
  -- Anything else that distinguishes this SKU within its series: border width,
  -- zari type, pallu design.
  variant_note       text,

  status             product_status not null default 'active',

  -- --- Commercial ---------------------------------------------------------
  -- What we pay the vendor. The PO carries its own price so a historic PO is
  -- never rewritten by a later price change; this is the default it starts from.
  cost_price         numeric(12, 2) check (cost_price is null or cost_price >= 0),
  mrp                numeric(12, 2) check (mrp is null or mrp >= 0),
  hsn_code           text           check (hsn_code is null or hsn_code ~ '^[0-9]{4,8}$'),
  gst_rate           numeric(5, 2)  not null default 5
                                    check (gst_rate >= 0 and gst_rate <= 28),

  -- --- Shopify mirror ------------------------------------------------------
  -- Nullable and stamped: a product may be commissioned here weeks before it is
  -- ever listed. Never treat these as authoritative if shopify_synced_at is null.
  shopify_product_id text,
  shopify_variant_id text,
  image_url          text,
  shopify_synced_at  timestamptz,

  -- --- Sell-through mirror -------------------------------------------------
  -- The "how is my design selling?" answer the vendors have asked for. Written
  -- by the Shopify sync, never by hand. Meaningless until sales_synced_at is
  -- set, and the UI says so rather than rendering a confident zero.
  units_on_hand      integer,
  units_sold_30d     integer,
  units_sold_90d     integer,
  first_sold_at      timestamptz,
  last_sold_at       timestamptz,
  sales_synced_at    timestamptz,

  -- --- Procurement history -------------------------------------------------
  -- Maintained by the purchase-order trigger in migration 009. Drives both the
  -- vendor's "what you usually send us" list and restock suggestions.
  first_ordered_at   timestamptz,
  last_ordered_at    timestamptz,
  units_ordered_total  integer        not null default 0,

  created_by         uuid           references app_users (id),
  created_at         timestamptz    not null default now(),
  updated_at         timestamptz    not null default now(),
  deleted_at         timestamptz,
  version            integer        not null default 1,

  -- A series belongs to exactly one vendor, so a product must not borrow a
  -- series from a different one. Enforced by trigger below (a CHECK cannot
  -- reach another table).
  constraint products_sold_dates_ordered
    check (first_sold_at is null or last_sold_at is null or last_sold_at >= first_sold_at)
);

-- Global SKU uniqueness: the code is printed on a physical label and scanned at
-- inward. Two vendors sharing one code would make that scan ambiguous.
create unique index products_sku_uniq on products (sku) where deleted_at is null;
create index products_vendor_idx  on products (vendor_id) where deleted_at is null;
create index products_series_idx  on products (series_id) where deleted_at is null;
create index products_title_trgm  on products using gin (title gin_trgm_ops);
create index products_sku_trgm    on products using gin ((sku::text) gin_trgm_ops);

create trigger products_touch
  before update on products
  for each row execute function app.touch_row();
create trigger products_no_hard_delete
  before delete on products
  for each row execute function app.forbid_hard_delete();

-- Guards the one cross-table invariant a CHECK constraint cannot express. If a
-- product could point at another vendor's series, the vendor-scoped catalogue
-- query would join across the isolation boundary and leak a series name.
create or replace function app.products_series_same_vendor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_series_vendor uuid;
begin
  if new.series_id is null then
    return new;
  end if;

  select s.vendor_id into v_series_vendor
    from public.product_series s
   where s.id = new.series_id;

  if v_series_vendor is distinct from new.vendor_id then
    raise exception
      'Product % cannot belong to a series owned by a different vendor.', new.sku
      using errcode = 'foreign_key_violation';
  end if;

  return new;
end;
$$;

create trigger products_series_same_vendor_trg
  before insert or update of series_id, vendor_id on products
  for each row execute function app.products_series_same_vendor();

comment on table products is
  'One sellable SKU. The `sku` column is the code the vendor prints on the label and the warehouse scans at inward.';
comment on column products.sales_synced_at is
  'When the Shopify sell-through mirror was last written. NULL means the sales columns are unknown, not zero.';
comment on column products.cost_price is
  'Default purchase price. Purchase order lines snapshot their own price so historic orders are never rewritten by a price change.';

select app.enable_audit('product_series');
select app.enable_audit('products');
