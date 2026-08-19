-- =============================================================================
-- 022 — Product intake: the Product Master, as a table
-- =============================================================================
-- Replaces a five-tab Google Sheet. The tabs map as follows:
--
--   CONFIG       -> typed columns on app_settings (below)
--   MASTER_DATA  -> master_data, discovered by the Shopify sync
--   CODE_CLAIMS  -> deleted; see product_seq
--   PRODUCTS     -> product_intakes
--   ERRORS       -> intake_errors
--
-- THE ONE DECISION EVERYTHING ELSE FOLLOWS FROM
--
-- None of this goes on `products`. `products` is a read model: migration 017's
-- `sync_upsert_products` upserts it every thirty minutes, and its ON CONFLICT
-- clause enumerates exactly which columns the sync owns. Putting approval
-- status, Drive folder ids or an error stage there would mean the first person
-- to press "Sync now" silently erased the state of every saree still in flight.
--
-- So the creation lifecycle lives beside the catalogue and joins to it on `sku`.
-- A row is born here at submission and lives here through publication;
-- `products` gets its row from Shopify, exactly as it does for the designs
-- already in the catalogue.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------

-- Seven attribute vocabularies. Only the first three are discoverable from a
-- SKU — `VENDOR-COLLECTION-FABRIC-COLOUR-CODE` accounts for four segments and
-- the first is the vendor, which lives in `vendors` and not here. The remaining
-- four are attributes with no code position: they reach Shopify and the AI
-- prompt, never the SKU.
create type master_data_type as enum (
  'collection',
  'fabric',
  'colour',
  'product_type',
  'pattern',
  'border',
  'pallu'
);

-- A code arrives from the sync knowing only its own spelling. `BRHM` is in the
-- SKU; whether it means "Bridal" or "Brahmin" is not, and cannot be derived.
create type master_data_status as enum (
  'unnamed',   -- discovered by the sync, awaiting a human label
  'named',     -- has a label; selectable at intake
  'ignored'    -- deliberately never to be offered (typos, dead codes)
);

-- The full lifecycle from PRODUCT-MASTER.md. V1 wrote only the observable
-- subset; the intermediate states are permitted here and reserved, so a future
-- step that wants to record EASYECOM_CREATED separately does not need a
-- migration. DRAFT is new: it holds a submission whose vocabulary does not exist
-- yet (see the request-a-new-value flow).
create type intake_status as enum (
  'DRAFT',
  'NEW',
  'VALIDATING',
  'SKU_CREATED',
  'SHOPIFY_CREATED',
  'EASYECOM_CREATED',
  'MAPPING_CHECKED',
  'READY_FOR_SHOOT',
  'SHOOT_PENDING',
  'IMAGES_RECEIVED',
  'READY_FOR_REVIEW',
  'APPROVED',
  'PUBLISHED',
  'REJECTED',
  'ERROR'
);

create type mapping_status  as enum ('NOT_CHECKED', 'MAPPED', 'MAPPING_ERROR');
create type image_status    as enum ('SHOOT_PENDING', 'IMAGES_RECEIVED', 'READY_FOR_REVIEW');
create type approval_status as enum ('PENDING', 'APPROVED', 'REJECTED', 'BLOCKED');
create type publish_status  as enum ('NOT_PUBLISHED', 'PUBLISHED');

-- Which step failed. Kept as an enum rather than free text because the daily
-- digest groups by it and a typo would silently create a new category.
create type intake_stage as enum (
  'INTAKE', 'VALIDATION', 'IDEMPOTENCY', 'UNIQUE_CODE', 'SKU', 'PRODUCT_MASTER',
  'AI_NAME', 'AI_DESCRIPTION', 'SHOPIFY_CREATE', 'SHOPIFY_VARIANT',
  'DRIVE_FOLDER', 'DRIVE_RAW_IMAGE', 'SHOPIFY_RAW_IMAGE',
  'WMS_CREATE', 'WMS_MAPPING', 'FINALISE',
  'IMAGE_SYNC', 'ADD_MEDIA', 'DELETE_MEDIA', 'REORDER_MEDIA',
  'APPROVAL_PUBLISH', 'PUBLISH_VALIDATION', 'CORRECTION'
);

-- -----------------------------------------------------------------------------
-- product_seq — the Unique Code
-- -----------------------------------------------------------------------------
-- This sequence is the entire replacement for the CODE_CLAIMS tab and the
-- `NERIGE SUB - Allocate Unique Code` workflow.
--
-- That allocator existed because Google Sheets has no sequences and a
-- read-then-increment would race two simultaneous submissions onto the same
-- code. It worked by appending a claim row and reading back its ROW POSITION,
-- which is why PRODUCT-MASTER.md warns never to sort, reorder, delete or insert
-- rows in that tab. Postgres gives real atomicity in one call and no such
-- warning is needed.
--
-- Starts at 16001 deliberately. `products.seq` — the trailing number of the SKU
-- — runs 1..15,549 across the seeded catalogue, so the first saree created
-- through this system continues one series rather than starting a second.
create sequence product_seq
  as bigint
  start with 16001
  minvalue 16001
  no cycle;

comment on sequence product_seq is
  'The Unique Code. Continues products.seq, which ends at 15,549 in the seeded catalogue. Concurrency-safe by construction (PRD 3, 26).';

-- Sequences created after migration 006 are not covered by its blanket revoke.
revoke all on sequence product_seq from anon, authenticated;

-- -----------------------------------------------------------------------------
-- master_data — discovered by the sync, named once by a human
-- -----------------------------------------------------------------------------
-- Primary key is (type, code), not (type, value): the code is what the sync can
-- know for certain, and the label is what it cannot know at all.
create table master_data (
  type          master_data_type   not null,
  code          text               not null
                                   check (code ~ '^[A-Z0-9][A-Z0-9_-]{0,15}$'),
  value         text               check (value is null
                                     or length(trim(value)) between 1 and 120),
  status        master_data_status not null default 'unnamed',

  -- How many catalogue products carry this code, and three of them by way of
  -- example. Both exist so the naming screen can sort commonest-first and show
  -- a human enough context to answer "what is BRHM?" without leaving the page.
  design_count  integer            not null default 0 check (design_count >= 0),
  examples      jsonb              not null default '[]'::jsonb
                                   check (jsonb_typeof(examples) = 'array'),

  -- Retires a value without deleting its history. A fabric Nerige no longer
  -- weaves must stop being offered at intake while every SKU that used it keeps
  -- resolving.
  active        boolean            not null default true,

  first_seen_at timestamptz        not null default now(),
  created_at    timestamptz        not null default now(),
  updated_at    timestamptz        not null default now(),
  version       integer            not null default 1,

  primary key (type, code),

  -- A code that is offered at intake must have a label to offer.
  constraint master_data_named_needs_value
    check (status <> 'named' or (value is not null and length(trim(value)) > 0))
);

-- Two codes must not share a label within a type: the intake dropdown shows the
-- label, so a duplicate would be two indistinguishable options producing
-- different SKUs.
create unique index master_data_value_uniq
  on master_data (type, lower(trim(value)))
  where status = 'named';

-- The naming screen: unnamed first, commonest first.
create index master_data_unnamed_idx
  on master_data (type, design_count desc)
  where status = 'unnamed';

create trigger master_data_touch
  before update on master_data
  for each row execute function app.touch_row();

comment on table master_data is
  'Attribute vocabularies. collection/fabric/colour are discovered by the Shopify sync from SKU segments; the rest are entered by an admin. Vendor is deliberately absent — it lives in `vendors`, so vendors.code IS the SKU prefix by construction.';
comment on column master_data.code is
  'The SKU fragment, for the three discoverable types. For the other four it is an internal identifier with no SKU position.';
comment on column master_data.status is
  'unnamed rows are never offered at intake. A sync discovering a new code raises exactly one review item rather than a silent NULL.';

-- -----------------------------------------------------------------------------
-- product_intakes — the Product Master
-- -----------------------------------------------------------------------------
create table product_intakes (
  -- Identity ------------------------------------------------------------------
  -- Assigned by a trigger, not a column default. A `default nextval(...)`
  -- requires the INSERTING role to hold USAGE on the sequence, which would mean
  -- granting every authenticated session the ability to burn codes — see the
  -- note at the foot of this file.
  unique_code       bigint      primary key,
  sku               text        unique
                                check (sku is null or length(trim(sku)) between 1 and 120),

  -- The idempotency guarantee, and the whole of it. V1 carried three
  -- hand-rolled guards in WF1 — a lookup by intake key, a check for an existing
  -- Shopify product, and an early write of the Shopify id. This one constraint
  -- replaces all three: a repeat submission is an ON CONFLICT that returns the
  -- code already allocated and creates nothing (PRD 25).
  --
  -- Generated by the application, never typed by a person, so the guarantee
  -- does not depend on somebody inventing a unique string.
  intake_key        text        not null unique
                                check (length(trim(intake_key)) between 1 and 200),

  status            intake_status not null default 'NEW',

  -- Submitted attributes -------------------------------------------------------
  -- Vendor is a foreign key rather than a code, because v3 derives vendor
  -- ownership from the SKU prefix and has deliberately no product-to-vendor
  -- mapping table. Referencing `vendors` here means a new saree cannot be
  -- minted under a prefix that has no weaver behind it — which would have
  -- produced a product invisible to the person who made it.
  vendor_id         uuid        not null references vendors (id),

  collection_code   text        not null,
  fabric_code       text        not null,
  colour_code       text        not null,
  product_type_code text        not null,
  pattern_code      text,
  border_code       text,
  pallu_code        text,

  -- Pricing --------------------------------------------------------------------
  cost_price        numeric(12, 2) not null check (cost_price > 0),
  mrp               numeric(12, 2) check (mrp is null or mrp > 0),
  currency          text        not null default 'INR',

  -- AI content -----------------------------------------------------------------
  product_name         text,
  product_description  text,
  seo_title            text,
  seo_description      text,
  tags                 text,

  -- Shopify ---------------------------------------------------------------------
  -- Written immediately after creation and before any later step can fail,
  -- which is what makes a retry safe.
  shopify_product_id        text,
  shopify_variant_id        text,
  shopify_inventory_item_id text,

  -- WMS -------------------------------------------------------------------------
  easyecom_product_id text,
  easyecom_sku        text,   -- must equal sku (PRD 18)
  mapping_status      mapping_status not null default 'NOT_CHECKED',

  -- Google Drive -----------------------------------------------------------------
  drive_folder_id           text,
  drive_raw_folder_id       text,
  drive_edited_folder_id    text,
  raw_image_file_id         text,
  raw_image_shopify_media_id text,

  -- Images --------------------------------------------------------------------
  img_status   image_status not null default 'SHOOT_PENDING',
  image_count  integer      not null default 0 check (image_count >= 0),

  -- {"<driveFileId>": "<shopifyMediaId>"}. jsonb rather than a string in a
  -- spreadsheet cell, so the reconciliation map is queryable. This map is what
  -- makes WF2 a reconciliation rather than an upload: media is matched by Drive
  -- file id, never by filename or position (PRD 15).
  image_map    jsonb        not null default '{}'::jsonb
                            check (jsonb_typeof(image_map) = 'object'),

  -- Approval and publishing ------------------------------------------------------
  approval_status  approval_status not null default 'PENDING',
  approved_by      uuid            references app_users (id),
  approved_at      timestamptz,
  rejection_reason text,

  publish_status   publish_status  not null default 'NOT_PUBLISHED',
  published_at     timestamptz,

  -- Errors (PRD 24 minimum fields) -----------------------------------------------
  error_status    boolean      not null default false,
  error_stage     intake_stage,
  error_message   text,
  last_attempt_at timestamptz,
  retry_count     integer      not null default 0 check (retry_count >= 0),

  -- Audit -------------------------------------------------------------------------
  -- New relative to the sheet, which had no idea who submitted what. The queue
  -- needs it to answer "show me mine", and a correction needs to know whom to
  -- ask about a strange cost price.
  submitted_by uuid        references app_users (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  version      integer     not null default 1,

  -- A rejection without a reason is not a rejection, it is a disappearance.
  constraint product_intakes_rejection_needs_reason
    check (approval_status <> 'REJECTED'
           or (rejection_reason is not null and length(trim(rejection_reason)) > 0)),

  -- An error row must say which step failed, or the digest cannot group it and
  -- nobody can act on it.
  constraint product_intakes_error_needs_stage
    check (not error_status or error_stage is not null),

  constraint product_intakes_published_needs_timestamp
    check (publish_status <> 'PUBLISHED' or published_at is not null)
);

-- The queue screen: newest first, filtered by status.
create index product_intakes_status_idx  on product_intakes (status, created_at desc);
create index product_intakes_vendor_idx  on product_intakes (vendor_id, created_at desc);
create index product_intakes_mine_idx    on product_intakes (submitted_by, created_at desc);
-- "Show me only what is broken" — the first thing anyone opens the queue for.
create index product_intakes_errors_idx  on product_intakes (error_stage, last_attempt_at desc)
  where error_status;
-- WF2 selects everything eligible for image reconciliation.
create index product_intakes_image_sync_idx on product_intakes (img_status)
  where status in ('READY_FOR_SHOOT', 'IMAGES_RECEIVED', 'READY_FOR_REVIEW');

-- Allocates the Unique Code. SECURITY DEFINER so the sequence stays ungranted:
-- the code is minted by the database on the caller's behalf, and the caller
-- never holds nextval() itself.
--
-- Honours a supplied value so a backfill or a fixture can pin one, and advances
-- the sequence past it if it is higher — otherwise a seeded 16050 would collide
-- with the natural 16050 fifty submissions later.
create or replace function app.assign_unique_code()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.unique_code is null then
    new.unique_code := nextval('public.product_seq');
  elsif new.unique_code > (select last_value from public.product_seq) then
    -- Not currval(): that raises `currval of sequence "product_seq" is not yet
    -- defined in this session` on any session that has not itself called
    -- nextval, which is every session that only ever supplies a code.
    perform setval('public.product_seq', new.unique_code);
  end if;
  return new;
end;
$$;

create trigger product_intakes_assign_code
  before insert on product_intakes
  for each row execute function app.assign_unique_code();

create trigger product_intakes_touch
  before update on product_intakes
  for each row execute function app.touch_row();

-- History matters here: this is the audit layer (PRD 29). A mistaken DELETE
-- would destroy the record of a product that reached Shopify.
create trigger product_intakes_no_hard_delete
  before delete on product_intakes
  for each row execute function app.forbid_hard_delete();

comment on table product_intakes is
  'The Product Master. One row per saree from submission to publication. Joins to `products` on sku; never merged into it, because `products` is upserted by the Shopify sync and would clobber in-flight state.';
comment on column product_intakes.intake_key is
  'Idempotency key, generated by the application. The unique constraint here replaces the three hand-rolled guards V1 carried in WF1.';
comment on column product_intakes.image_map is
  'driveFileId -> shopifyMediaId. The basis of reconciliation: a Drive file is matched to its Shopify media object by id, never by filename or position.';

-- -----------------------------------------------------------------------------
-- Free text is rejected, in the database
-- -----------------------------------------------------------------------------
-- PRD §4 and §5 require that an attribute not present in the controlled
-- vocabulary is refused rather than silently minting a new SKU code. Enforcing
-- that only in the form would mean a direct insert — a script, a fixture, an
-- n8n node — could still create a corrupt code, and every SKU using it
-- afterwards would inherit the corruption.
--
-- A trigger rather than seven composite foreign keys: master_data's key is
-- (type, code), so a plain FK cannot pin the type without a generated constant
-- column per attribute. Seven of those are less readable than one function that
-- names the offending field in its error message. master_data rows are retired
-- with `active` and never hard-deleted, so referential integrity on delete is
-- not the property being bought.
create or replace function app.validate_intake_vocabulary()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pairs constant text[][] := array[
    ['collection',   new.collection_code],
    ['fabric',       new.fabric_code],
    ['colour',       new.colour_code],
    ['product_type', new.product_type_code],
    ['pattern',      new.pattern_code],
    ['border',       new.border_code],
    ['pallu',        new.pallu_code]
  ];
  v_type text;
  v_code text;
begin
  for i in 1 .. array_length(v_pairs, 1) loop
    v_type := v_pairs[i][1];
    v_code := v_pairs[i][2];

    -- The last three are optional; absent is fine, wrong is not.
    continue when v_code is null;

    if not exists (
      select 1
        from public.master_data m
       where m.type   = v_type::public.master_data_type
         and m.code   = v_code
         and m.status = 'named'
         and m.active
    ) then
      raise exception
        '% "%" is not an active, named value in master_data.', v_type, v_code
        using errcode = 'foreign_key_violation',
              hint    = 'Add it at /admin/master-data, or pick an existing value.';
    end if;
  end loop;

  return new;
end;
$$;

-- DRAFT is exempt: that status exists precisely to hold a submission whose
-- vocabulary does not exist yet, while an admin decides whether to add it.
create trigger product_intakes_vocabulary
  before insert or update of
    collection_code, fabric_code, colour_code, product_type_code,
    pattern_code, border_code, pallu_code, status
  on product_intakes
  for each row
  when (new.status <> 'DRAFT')
  execute function app.validate_intake_vocabulary();

-- -----------------------------------------------------------------------------
-- intake_errors — append only
-- -----------------------------------------------------------------------------
-- Nothing overwrites a row here (PRD 24). The columns on product_intakes carry
-- the CURRENT error; this carries every error that ever happened, which is the
-- difference between "this product is broken" and "this product has failed at
-- WMS_MAPPING four times this week".
create table intake_errors (
  id            bigserial   primary key,
  unique_code   bigint      references product_intakes (unique_code),
  intake_key    text,
  workflow      text        not null,
  stage         intake_stage not null,
  error_message text        not null,
  payload       jsonb       not null default '{}'::jsonb,

  -- Set by hand once somebody has dealt with it. Nothing reads it yet; it is
  -- for the operations lead's own triage, exactly as the ERRORS tab was.
  resolved      boolean     not null default false,
  resolved_by   uuid        references app_users (id),
  resolved_at   timestamptz,

  created_at    timestamptz not null default now()
);

create index intake_errors_code_idx  on intake_errors (unique_code, created_at desc);
create index intake_errors_open_idx  on intake_errors (stage, created_at desc)
  where not resolved;

create trigger intake_errors_no_hard_delete
  before delete on intake_errors
  for each row execute function app.forbid_hard_delete();

comment on table intake_errors is
  'Append-only error log. The current failure lives on product_intakes; this is the history.';

-- -----------------------------------------------------------------------------
-- app_settings — the CONFIG tab, typed
-- -----------------------------------------------------------------------------
-- Typed columns rather than the sheet's key/value pairs. `1.60 ` with a
-- trailing space is a number here and was a string there, and a markup
-- multiplier that silently parses to NULL prices every saree wrong.
--
-- Two of the CONFIG keys already existed: drive_folder_id and slack_channel_id.
alter table app_settings
  add column mrp_markup_multiplier  numeric(6, 3) not null default 1.600
    check (mrp_markup_multiplier > 0),
  add column mrp_rounding_nearest   integer       not null default 10
    check (mrp_rounding_nearest > 0),
  add column currency               text          not null default 'INR',
  add column sku_separator          text          not null default '-',

  add column shopify_publication_id text,
  add column shopify_api_version    text          not null default '2026-01',

  add column ai_model               text          not null default 'claude-opus-5',
  add column ai_effort              text          not null default 'low'
    check (ai_effort in ('low', 'medium', 'high', 'xhigh', 'max')),
  add column ai_max_tokens          integer       not null default 2000
    check (ai_max_tokens between 256 and 32000),
  add column ai_name_prompt         text,
  add column ai_description_prompt  text,

  add column drive_subfolder_raw    text          not null default 'RAW',
  add column drive_subfolder_edited text          not null default 'EDITED',
  -- Shopify fetches product media over public HTTP, so a Drive image has to be
  -- link-readable. See LIMITATIONS.md: the alternative is Shopify staged
  -- uploads, three extra calls per image, not built.
  add column drive_public_image_url_template text not null
    default 'https://lh3.googleusercontent.com/d/{fileId}=s0',

  add column image_allowed_extensions     text    not null default 'jpg,jpeg,png,webp',
  add column image_remove_raw_when_edited boolean not null default true,
  add column image_min_count_for_review   integer not null default 1
    check (image_min_count_for_review >= 0),

  add column easyecom_enabled      boolean not null default true,
  add column easyecom_base_url     text    not null default 'https://api.easyecom.io',
  -- Not a secret; the credentials that go with it live in n8n. Stored here
  -- because it identifies WHICH warehouse, which is configuration.
  add column easyecom_location_key text;

comment on column app_settings.shopify_publication_id is
  'Online Store publication gid. Until set, WF3 marks a product ACTIVE but does not publish it to the storefront, and says so in Slack rather than reporting success.';
comment on column app_settings.easyecom_location_key is
  'EasyEcom warehouse identifier. Found at Account Settings -> Company Information -> Seller ID; it cannot be read from the API, because the endpoint that lists locations itself requires a token minted with it.';

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
-- Deny by default, forced so it applies to the owner too, and no privilege for
-- anon anywhere — the same three rules migration 006 set.
--
-- None of these tables is vendor-scoped and none is readable by a weaver. A
-- saree that has not been published is not a thing a vendor may see.
alter table master_data     enable row level security;
alter table product_intakes enable row level security;
alter table intake_errors   enable row level security;

alter table master_data     force row level security;
alter table product_intakes force row level security;
alter table intake_errors   force row level security;

-- master_data: every employee reads (the dropdowns), only the owner writes.
create policy master_data_staff_read on master_data
  for select to authenticated
  using ((select app.is_staff()));

create policy master_data_admin_write on master_data
  for all to authenticated
  using      ((select app.is_admin()))
  with check ((select app.is_admin()));

-- product_intakes: read is deliberately unscoped across staff. A warehouse team
-- has more than one person, and support answering "where is this saree" has to
-- be able to look up anything. Writes are scoped below.
create policy product_intakes_staff_read on product_intakes
  for select to authenticated
  using ((select app.is_staff()));

create policy product_intakes_submit on product_intakes
  for insert to authenticated
  with check ((select app.can_submit_intake()));

-- An admin may correct anything at any time. A warehouse manager may correct
-- only their own submission, and only while nothing a customer can see exists
-- yet — once it is APPROVED or PUBLISHED it is the owner's alone.
create policy product_intakes_update on product_intakes
  for update to authenticated
  using (
    (select app.is_admin())
    or (
      (select app.can_submit_intake())
      and submitted_by = (select auth.uid())
      and status in ('DRAFT', 'NEW', 'VALIDATING', 'SKU_CREATED', 'SHOPIFY_CREATED',
                     'READY_FOR_SHOOT', 'SHOOT_PENDING', 'IMAGES_RECEIVED', 'ERROR')
    )
  )
  with check (
    (select app.is_admin())
    or (
      (select app.can_submit_intake())
      and submitted_by = (select auth.uid())
    )
  );

-- intake_errors: everyone sees what is broken; only the owner marks it resolved.
create policy intake_errors_staff_read on intake_errors
  for select to authenticated
  using ((select app.is_staff()));

create policy intake_errors_admin_write on intake_errors
  for all to authenticated
  using      ((select app.is_admin()))
  with check ((select app.is_admin()));

-- Privileges, granted back narrowly after 006's blanket revoke.
grant select                 on master_data     to authenticated;
grant insert, update, delete on master_data     to authenticated;
grant select, insert, update on product_intakes to authenticated;
grant select, insert, update on intake_errors   to authenticated;
grant usage                  on sequence intake_errors_id_seq to authenticated;

-- product_seq is NOT granted. A Unique Code is allocated server-side on the
-- insert default; a client that could call nextval() directly could burn codes
-- without creating anything, leaving permanent gaps in a series that a weaver
-- writes onto fabric by hand.
