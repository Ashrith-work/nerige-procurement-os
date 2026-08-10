-- =============================================================================
-- 014 — Live Shopify data, and deciding which photograph a weaver sees
-- =============================================================================
-- The CSV loader stays in the repository as a fallback, but it is no longer the
-- source of truth. From here, `products` is refreshed from Shopify's Admin
-- GraphQL API every thirty minutes.
--
-- THREE THINGS THIS SCHEMA HAS TO GET RIGHT, all of which are about damage a
-- sync can do that nobody notices for a week:
--
-- 1. A SYNC NEVER DELETES. A product that stops coming back from Shopify is
--    marked `is_active = false`, not removed. Deleting would cascade nothing —
--    `order_lines.sku` is a plain FK — but it would break every order line
--    pointing at it and erase a design a weaver may be halfway through making.
--    A disappearance is far more often a Shopify filter change than a saree
--    that ceased to exist.
--
-- 2. A SYNC NEVER OVERWRITES A MANUAL OVERRIDE. `manual_image_url` and
--    `crop_json` are what a human chose after looking at the picture. The sync
--    writes `image_urls` and `display_image_url` and leaves those two alone —
--    otherwise every half-hour quietly undoes the afternoon someone spent
--    fixing crops.
--
-- 3. THE IMAGE IS A DECISION, NOT A COLUMN. Shopify returns a median of eleven
--    images per product and the first is nearly always the full-length model
--    shot where the saree is a quarter of the frame. Position 3 is, by
--    inspection of this catalogue, the fabric. So position is stored per
--    product with a default of 3, and the resolution order is written down
--    once in `resolveProductImage()`.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- products — identity in Shopify, every image, and the chosen one
-- -----------------------------------------------------------------------------
alter table products
  -- Shopify's own ids, so a re-sync matches on identity rather than on SKU
  -- alone and a renamed SKU is visible as a change rather than as one product
  -- vanishing and another appearing.
  add column shopify_product_id  text,
  add column shopify_variant_id  text,

  -- Every image Shopify holds, in Shopify's order. Needed in full because the
  -- admin image editor offers a choice among them, and re-fetching one product's
  -- images on demand would be a second Admin API call from a page render.
  add column image_urls          jsonb   not null default '[]'::jsonb,

  -- What the resolution rule produced at sync time. Denormalised so that the
  -- reorder grid, which renders 120 tiles, does not evaluate a rule per tile.
  add column display_image_url   text,

  -- 1-based, matching how Shopify numbers them and how a person counts.
  add column display_image_position integer not null default 3
                                     check (display_image_position >= 1),

  add column crop_mode           text    not null default 'top'
                                 check (crop_mode in ('top', 'centre', 'none')),

  -- The two a human wrote. Never touched by a sync.
  add column manual_image_url    text,
  add column crop_json           jsonb,

  -- Soft delete. See note 1 above.
  add column is_active           boolean not null default true,

  add column last_synced_at      timestamptz;

comment on column products.image_urls is
  'Every Shopify image for this product, in Shopify order. The admin image editor picks from these.';
comment on column products.display_image_position is
  'Which Shopify image to show, 1-based. Defaults to 3: image 1 is the full-length model shot on nearly every product in this catalogue, and the saree is a quarter of that frame.';
comment on column products.manual_image_url is
  'Chosen by a human, and therefore never overwritten by a sync. Beats display_image_url.';
comment on column products.crop_json is
  'Hand-drawn crop rectangle as fractions of the source: {"x":0,"y":0.18,"w":1,"h":0.7}. Null means use crop_mode.';
comment on column products.is_active is
  'False when Shopify stopped returning this product. Never deleted — a disappearance is usually a filter change, not a saree that ceased to exist.';

-- The reorder grid and the catalogue both read active rows only. Partial
-- indexes rather than a column in the existing ones: inactive rows are a
-- handful, and widening every index to carry a boolean that is true 99% of the
-- time earns nothing.
create index products_active_vendor_seq_idx
  on products (vendor_id, seq desc) where is_active;

create index products_shopify_id_idx
  on products (shopify_product_id) where shopify_product_id is not null;

-- -----------------------------------------------------------------------------
-- sync_runs — what happened, and how long ago
-- -----------------------------------------------------------------------------
-- Every screen that shows a quantity shows how old it is, and this is where
-- that age comes from once stock stops arriving in a CSV. A run that failed is
-- recorded as loudly as one that succeeded: a sync that has been silently
-- failing for three days is exactly the state that puts stale numbers in front
-- of a weaver while every screen still says "checked 30 minutes ago".
create table sync_runs (
  id           uuid        primary key default gen_random_uuid(),

  kind         text        not null
                           check (kind in ('shopify_products', 'shopify_orders')),
  status       text        not null default 'running'
                           check (status in ('running', 'succeeded', 'failed')),

  -- Who asked. Null for the scheduled run, set when an admin pressed the button.
  triggered_by uuid        references app_users (id),

  started_at   timestamptz not null default now(),
  finished_at  timestamptz,

  rows_seen    integer     not null default 0,
  rows_changed integer     not null default 0,

  error        text
);

create index sync_runs_kind_started_idx on sync_runs (kind, started_at desc);

-- The question every screen asks: when did this last WORK. Not when did it last
-- run — a failed run is not a sync, and treating it as one is how a three-day-
-- old number gets presented as half an hour old.
create index sync_runs_last_success_idx
  on sync_runs (kind, finished_at desc) where status = 'succeeded';

comment on table sync_runs is
  'One row per sync attempt, successful or not. The source of the sync age shown beside every quantity.';

-- -----------------------------------------------------------------------------
-- app_settings — the handful of single values this system has
-- -----------------------------------------------------------------------------
-- A singleton, enforced by a CHECK on the primary key rather than by convention.
-- The alternative is a key/value table, which turns every typed setting into a
-- string and every read into a parse.
create table app_settings (
  id                  integer     primary key default 1 check (id = 1),

  -- Phase 7. Pasted once by the admin; the folder id is parsed out of it.
  drive_folder_url    text,
  drive_folder_id     text,

  -- Phase 7. Chosen from a picker populated by the Slack API.
  slack_channel_id    text,
  slack_channel_name  text,

  -- Purchase order numbering.
  po_prefix           text        not null default 'NRG-PO',

  updated_at          timestamptz not null default now(),
  updated_by          uuid        references app_users (id)
);

insert into app_settings (id) values (1);

create trigger app_settings_touch
  before update on app_settings
  for each row execute function app.touch_row();

-- -----------------------------------------------------------------------------
-- Isolation
-- -----------------------------------------------------------------------------
-- Neither table is vendor-scoped, and neither is readable by a weaver. Sync
-- timings and a Slack channel are Nerige's operational detail; the sync AGE she
-- sees comes from `products.stock_synced_at`, which she already reads.
alter table sync_runs enable row level security;
alter table sync_runs force row level security;

create policy sync_runs_internal on sync_runs
  for all to authenticated
  using      ((select app.is_internal()))
  with check ((select app.is_internal()));

alter table app_settings enable row level security;
alter table app_settings force row level security;

create policy app_settings_internal on app_settings
  for all to authenticated
  using      ((select app.is_internal()))
  with check ((select app.is_internal()));

grant select, insert, update on sync_runs   to authenticated;
grant select, update          on app_settings to authenticated;

-- -----------------------------------------------------------------------------
-- The admin image editor needs to write products
-- -----------------------------------------------------------------------------
-- `products` had no UPDATE policy at all until now: the CSV loader runs as the
-- table owner from a script, and the sync RPCs are SECURITY DEFINER, so nothing
-- had ever needed one. Choosing an image and drawing a crop is the first thing
-- a signed-in human does to this table.
--
-- Internal only, and deliberately not narrowed to the image columns. Postgres
-- policies cannot restrict an UPDATE to a subset of columns — that is what
-- column-level GRANTs are for — so the narrowing is done in the grant below.
-- A weaver has no UPDATE grant on this table at all and so cannot reach it.
create policy products_update_internal on products
  for update to authenticated
  using      ((select app.is_internal()))
  with check ((select app.is_internal()));

-- Column-level, so that even a bug in an admin code path cannot rewrite a SKU,
-- a vendor_id or a quantity. The SKU is the string a weaver copies onto a
-- fabric label; the vendor_id is the whole of isolation. Neither is editable
-- from a screen, and this is what makes that structural rather than a habit.
grant update (
  display_image_url,
  display_image_position,
  crop_mode,
  manual_image_url,
  crop_json
) on products to authenticated;
