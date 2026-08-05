-- =============================================================================
-- 003 — The portal: products, orders, order lines, reference SKUs
-- =============================================================================
-- The four tables of spec §6, and nothing else.
--
-- Two ideas are load-bearing here and both are easy to get wrong later:
--
--   1. A SKU is a DESIGN, not a piece. `products.sku` is the primary key
--      because the design is the thing a weaver makes again from a photograph.
--      Serial numbers belong to the warehouse and live in EasyEcom.
--
--   2. Sold out means it SOLD. Shopify flips a product to `draft` when stock
--      hits zero, and `shopify_status` is stored purely as a fact about
--      Shopify. Nothing in this schema — no constraint, no index predicate, no
--      policy — filters on it. A draft product is the strongest reorder
--      candidate there is.
-- =============================================================================

create type order_status as enum (
  'issued',
  'accepted',
  'dispatched',
  'received',
  'cancelled'
);

-- The only structural difference between the two kinds of line is whether a
-- code comes back on the saree. Everything else follows from this enum.
create type line_type as enum ('restock', 'new_design');

-- -----------------------------------------------------------------------------
-- products — where Shopify's photographs meet EasyEcom's stock
-- -----------------------------------------------------------------------------
-- EasyEcom holds no images and no descriptions. Shopify holds no trustworthy
-- warehouse stock. This table is the only place the two meet, and that is the
-- portal's reason to exist (spec §4).
create table products (
  -- Stored verbatim, never normalised. Seed data contains SKUs with spaces
  -- around the hyphen ('DMG - 157'); rewriting one would change the string a
  -- weaver is asked to copy onto a fabric label by hand.
  sku                text primary key check (length(trim(sku)) between 1 and 120),

  -- Derived from the SKU prefix by the loader, never supplied independently.
  -- There is deliberately no product↔vendor mapping table (spec §2).
  vendor_id          uuid        not null references vendors (id),

  collection         text,
  fabric             text,
  colour_code        text,

  -- The trailing number in the SKU. Runs 1..15,549 across the catalogue and
  -- increases over time, so `order by seq desc` is "most recently added first"
  -- — the default sort, free and available today.
  seq                integer,

  -- Null until the EasyEcom SKU Performance export lands. When it does this
  -- becomes a second sort strategy ("fastest selling first") and nothing else.
  -- Nothing is modelled around sales data beyond this column.
  sales_rank         integer,

  title              text,
  description        text,
  image_url          text,
  price              numeric(12, 2),
  cost               numeric(12, 2),
  product_type       text,

  -- Shopify's own word for the product: active, draft, archived, unlisted.
  -- Recorded, never acted on. See the header note.
  shopify_status     text,

  -- EasyEcom `Available`, not `On hand`: available excludes pieces reserved
  -- against open customer orders, which is the number that answers "do we
  -- still have one" (spec §4). Seeded from CSV today.
  qty_available      integer     not null default 0,

  -- When qty_available was last refreshed. Every quantity shown on screen
  -- carries a visible sync age, because a stale number presented as live is
  -- worse than no number at all.
  stock_synced_at    timestamptz,

  last_ordered_at    timestamptz,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- The exact access path of /reorder: one vendor, then one collection, newest
-- first. Pooja works one weaver at a time and the screen never offers "all
-- vendors" as a default, so this is the index that matters.
create index products_vendor_collection_seq_idx
  on products (vendor_id, collection, seq desc);

-- The reorder pool is not a table; it is this predicate. 7,795 sold out plus
-- 1,108 last piece in the seed data. Negative quantities exist in the export
-- (oversold pieces) and are deliberately NOT in the pool, matching the supplied
-- reorder file exactly.
create index products_reorder_pool_idx
  on products (vendor_id, collection, seq desc)
  where qty_available in (0, 1);

-- Search by SKU or title on the reorder grid.
create index products_sku_trgm_idx   on products using gin (sku   gin_trgm_ops);
create index products_title_trgm_idx on products using gin (title gin_trgm_ops);

comment on table products is
  'One row per DESIGN. Shopify supplies the photograph and words, EasyEcom the available quantity; the SKU string is the join key and the vendor prefix.';
comment on column products.shopify_status is
  'Shopify''s status, recorded as fact. Never filter the reorder pool on it — a draft product sold out, which is proof of demand.';
comment on column products.qty_available is
  'EasyEcom Available (excludes stock reserved against open orders). Always render alongside stock_synced_at.';

-- -----------------------------------------------------------------------------
-- orders — one per vendor, several per press of the send button
-- -----------------------------------------------------------------------------
create sequence order_number_seq;

create table orders (
  id               uuid          primary key default gen_random_uuid(),

  -- Every order created by one press of "Send to 3 vendors" shares this.
  -- Pooja thinks in one decision; the vendors each receive their own order.
  batch_id         uuid          not null,

  vendor_id        uuid          not null references vendors (id),
  order_number     text          not null unique
                                 default ('ORD-' || lpad(nextval('order_number_seq')::text, 6, '0')),
  status           order_status  not null default 'issued',
  issued_at        timestamptz   not null default now(),

  -- The date the vendor commits to when she accepts.
  promised_date    date,
  dispatched_at    timestamptz,
  transport_docket text,

  created_by       uuid          references app_users (id),

  updated_at       timestamptz   not null default now(),
  version          integer       not null default 1,

  -- A dispatch record is meaningless without a date; the docket is the number
  -- the transporter gives, and arrives with it.
  constraint orders_dispatch_needs_date
    check (transport_docket is null or dispatched_at is not null)
);

create index orders_vendor_status_idx on orders (vendor_id, status, issued_at desc);
create index orders_batch_idx         on orders (batch_id);

create trigger orders_touch
  before update on orders
  for each row execute function app.touch_row();

comment on column orders.batch_id is
  'Shared by every order issued in one transaction. One press of send, one batch, one order per vendor.';

-- -----------------------------------------------------------------------------
-- order_lines — the two genuinely different things an order can ask for
-- -----------------------------------------------------------------------------
create table order_lines (
  id                 uuid      primary key default gen_random_uuid(),
  order_id           uuid      not null references orders (id) on delete cascade,
  line_type          line_type not null,

  -- Required on restock, forbidden on new_design. A new design has no code yet
  -- and the portal never invents one (spec §2).
  sku                text      references products (sku),

  -- Pooja's words. Required on new_design, forbidden on restock.
  brief              text,

  quantity           integer   not null default 1 check (quantity > 0),

  -- Why this design was in the pool when it was ordered: sold_out or
  -- last_piece. Meaningful only on a restock line.
  reorder_reason     text      check (reorder_reason in ('sold_out', 'last_piece')),

  -- Snapshots, taken at creation. The vendor must see what was ordered, not
  -- what the product record later became — a re-shoot that swaps the
  -- photograph must not silently change an order she already accepted.
  snapshot_title     text,
  snapshot_image_url text,
  snapshot_desc      text,

  -- Receiving is not in this build; the warehouse continues in EasyEcom. The
  -- column exists so that adding it later is a column rather than a rewrite.
  quantity_received  integer   check (quantity_received is null or quantity_received >= 0),

  constraint order_lines_shape check (
    (line_type = 'restock'
      and sku is not null
      and brief is null)
    or
    (line_type = 'new_design'
      and sku is null
      and brief is not null
      and length(trim(brief)) > 0)
  ),

  constraint order_lines_reason_restock_only check (
    line_type = 'restock' or reorder_reason is null
  )
);

create index order_lines_order_idx on order_lines (order_id, line_type);
create index order_lines_sku_idx   on order_lines (sku) where sku is not null;

comment on table order_lines is
  'A restock line names a SKU the weaver writes back onto the piece. A new_design line carries only a brief; nothing comes back with a code on it.';

-- -----------------------------------------------------------------------------
-- order_line_refs — "make me more like these"
-- -----------------------------------------------------------------------------
create table order_line_refs (
  id                 uuid primary key default gen_random_uuid(),
  order_line_id      uuid not null references order_lines (id) on delete cascade,
  sku                text not null references products (sku),
  snapshot_image_url text,

  -- The same photograph twice on one line says nothing extra.
  unique (order_line_id, sku)
);

create index order_line_refs_line_idx on order_line_refs (order_line_id);

-- -----------------------------------------------------------------------------
-- Reference SKUs belong to new-design lines, one to six of them
-- -----------------------------------------------------------------------------
-- Two guards, because the rule has two halves and only one of them can be
-- checked at statement time:
--
--   * "refs only on new_design lines" is checkable immediately, on write
--   * "between one and six" cannot be — a line is inserted before its first
--     ref exists, so this is a DEFERRED constraint trigger that fires at
--     COMMIT, by which point the whole line has been written
--
-- Both run SECURITY DEFINER with a pinned search_path: a data-integrity rule
-- must be evaluated against the true rows, never against whatever subset the
-- calling session's RLS policies happen to reveal.
create or replace function app.order_line_refs_require_new_design()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type public.line_type;
begin
  select ol.line_type into v_type
    from public.order_lines ol
   where ol.id = new.order_line_id;

  if v_type is distinct from 'new_design' then
    raise exception
      'Reference SKUs are only valid on a new_design line; line % is %.',
      new.order_line_id, coalesce(v_type::text, 'missing')
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger order_line_refs_require_new_design_trg
  before insert or update on order_line_refs
  for each row execute function app.order_line_refs_require_new_design();

create or replace function app.enforce_new_design_ref_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_line_id uuid;
  v_type    public.line_type;
  v_count   integer;
begin
  if tg_table_name = 'order_lines' then
    v_line_id := new.id;
  elsif tg_op = 'DELETE' then
    v_line_id := old.order_line_id;
  else
    v_line_id := new.order_line_id;
  end if;

  select ol.line_type into v_type
    from public.order_lines ol
   where ol.id = v_line_id;

  -- The parent line went away with its order (cascade). Nothing to constrain.
  if v_type is null or v_type <> 'new_design' then
    return null;
  end if;

  select count(*) into v_count
    from public.order_line_refs r
   where r.order_line_id = v_line_id;

  if v_count < 1 or v_count > 6 then
    raise exception
      'A new_design line carries one to six reference SKUs; line % has %.',
      v_line_id, v_count
      using errcode = 'check_violation';
  end if;

  return null;
end;
$$;

create constraint trigger order_lines_ref_count_trg
  after insert or update on order_lines
  deferrable initially deferred
  for each row execute function app.enforce_new_design_ref_count();

create constraint trigger order_line_refs_count_trg
  after insert or update or delete on order_line_refs
  deferrable initially deferred
  for each row execute function app.enforce_new_design_ref_count();

comment on function app.enforce_new_design_ref_count() is
  'Deferred to COMMIT: a new_design line is inserted before its reference SKUs exist, so the one-to-six rule can only be judged once the whole line is written.';
