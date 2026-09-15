-- =============================================================================
-- 035 — The intake workflow: how a saree moves, and who may move it
-- =============================================================================
-- Migration 022 built the Product Master as a table: the lifecycle enum, the
-- Unique Code sequence, the vocabulary trigger and the policies. What it did not
-- build is the MOVEMENT — nothing in the schema says that READY_FOR_REVIEW comes
-- after IMAGES_RECEIVED, or that the person who shot a saree may not be the one
-- who approves it. The screens arriving with this file (/intake/new, the queue,
-- /warehouse/shooting, /review) need both, and the database is where they have
-- to live for the same reason vendor isolation lives there.
--
-- TWO HOLES IN 022, CLOSED HERE
--
--   1. A warehouse manager could approve her own saree. `product_intakes_update`
--      lets her update her own submission while it is pre-approval, and its
--      WITH CHECK constrains only `submitted_by` — not the status being written.
--      So `update product_intakes set status = 'APPROVED', approval_status =
--      'APPROVED'` on her own SHOOT_PENDING row passed every policy. The same was
--      true of an INSERT that simply arrived as APPROVED. That is the separation
--      of duties `app.can_review_intake()` exists to express, defeated by one
--      statement.
--
--   2. Procurement could not approve anything. `can_review_intake()` admits
--      procurement_head, but no UPDATE policy on product_intakes names it, so
--      Pooja's approval would have been refused by RLS the first time she tried.
--
-- Both are fixed the same way, and without widening a single policy: status is
-- moved only by `transition_intake`, a SECURITY DEFINER function that holds the
-- transition table and checks the capability for each edge; and a guard trigger
-- refuses a direct write from a signed-in non-admin session that touches any
-- workflow column. The admin's "may correct anything at any time" from 022 is
-- kept exactly.
--
-- WHAT THIS FILE DELIBERATELY DOES NOT DO
--
-- Nothing here talks to Shopify, Drive or EasyEcom. SHOPIFY_CREATED,
-- EASYECOM_CREATED, MAPPING_CHECKED and PUBLISHED remain reachable only by the
-- n8n pipeline (service role) or an admin correction, because the steps that
-- would justify them are not wired. A status that claims a Shopify product
-- exists when none does is worse than a status that honestly stops short.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- New columns
-- -----------------------------------------------------------------------------

-- Why a draft is a draft. A DRAFT exists to hold a saree whose vocabulary does
-- not exist yet (migration 022's exemption), and "which value is missing" is the
-- one thing the admin naming it needs to know. Without a column for it, the
-- warehouse manager's explanation would live in a WhatsApp message.
alter table product_intakes
  add column draft_note text
    check (draft_note is null or length(draft_note) <= 1000);

-- The status timeline, append-only by construction. A jsonb array rather than a
-- separate events table for a reason worth stating: a table carrying a NOT NULL
-- foreign key to product_intakes is discovered by the isolation suite as
-- vendor-scoped (through product_intakes.vendor_id), and would then need its
-- own place in the suite's internal-only list. The history is a property of the
-- intake, read only with the intake, so it lives on the intake. The trigger
-- below rebuilds it from OLD on every update, so no caller — admin included —
-- can rewrite what already happened.
alter table product_intakes
  add column status_history jsonb not null default '[]'::jsonb
    check (jsonb_typeof(status_history) = 'array');

comment on column product_intakes.draft_note is
  'What a DRAFT is waiting for — usually the vocabulary value that does not exist yet. Written by the submitter.';
comment on column product_intakes.status_history is
  'Append-only [{status, at, by, note}]. Maintained by trigger from OLD; a client-supplied value is ignored.';

-- Rows already in flight get one entry: the status they hold now, dated from
-- creation. That is all that is known; inventing earlier steps would be fiction.
-- The touch trigger is suspended so the backfill does not rewrite every row's
-- updated_at to the moment this migration ran.
alter table product_intakes disable trigger product_intakes_touch;
update product_intakes
   set status_history = jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
         'status', status,
         'at',     created_at,
         'by',     submitted_by
       )))
 where status_history = '[]'::jsonb;
alter table product_intakes enable trigger product_intakes_touch;

-- The review queue: oldest waiting first.
create index product_intakes_review_idx
  on product_intakes (updated_at)
  where status = 'READY_FOR_REVIEW';

-- -----------------------------------------------------------------------------
-- Pure helpers — mirrored in src/lib/intake, and unit-tested there
-- -----------------------------------------------------------------------------

-- MRP = cost × multiplier, rounded UP to the configured step. Up, not nearest:
-- PRODUCT-MASTER.md specifies it, and WF1 did it, so a saree priced by the old
-- pipeline and one priced here cannot differ by ten rupees. A step of 1 (or
-- less) means "no rounding", kept to the paisa, again exactly as WF1 did.
--
-- numeric throughout. 1200 × 1.6 is 1920.0000000000002 in floating point, which
-- rounds UP to 1930 — the TypeScript twin has the same trap and a test for it.
create or replace function app.compute_mrp(
  p_cost       numeric,
  p_multiplier numeric,
  p_step       integer
)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
    when p_cost is null or p_multiplier is null then null
    when coalesce(p_step, 1) > 1 then ceil(p_cost * p_multiplier / p_step) * p_step
    else round(p_cost * p_multiplier, 2)
  end;
$$;

-- The SKU. `VENDOR-COLLECTION-FABRIC-COLOUR-UNIQUECODE`, joined with the
-- configured separator. The last segment is the Unique Code rather than a
-- per-collection sequence, so the number a person writes on the fabric is the
-- same number the Product Master is keyed on.
create or replace function app.compose_intake_sku(
  p_vendor_code     text,
  p_collection_code text,
  p_fabric_code     text,
  p_colour_code     text,
  p_unique_code     bigint,
  p_separator       text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select concat_ws(
    coalesce(nullif(p_separator, ''), '-'),
    p_vendor_code, p_collection_code, p_fabric_code, p_colour_code, p_unique_code::text
  );
$$;

-- The MRP for a cost, at today's settings. SECURITY DEFINER because
-- app_settings is readable only by admin and procurement (migration 015), and
-- the person entering a cost price is the warehouse manager. What leaves this
-- function is one number, not the settings row.
create or replace function app.intake_mrp(p_cost numeric)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select app.compute_mrp(p_cost, s.mrp_markup_multiplier, s.mrp_rounding_nearest)
    from public.app_settings s
   where s.id = 1;
$$;

-- Which of the submitted codes are not offered at intake, as "type CODE" strings.
-- The same predicate as `app.validate_intake_vocabulary` (named AND active), asked
-- as a question instead of raised as an error — so `save_intake` can refuse
-- BEFORE it allocates a Unique Code. Raising from the trigger after nextval()
-- would burn the code, and a gap in a series written onto fabric by hand reads
-- as a lost saree.
create or replace function app.missing_intake_vocabulary(
  p_collection   text,
  p_fabric       text,
  p_colour       text,
  p_product_type text,
  p_pattern      text,
  p_border       text,
  p_pallu        text
)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(t.type || ' ' || coalesce(t.code, '(none)') order by t.ord), '{}')
    from (values
      (1, 'collection',   p_collection,   true),
      (2, 'fabric',       p_fabric,       true),
      (3, 'colour',       p_colour,       true),
      (4, 'product_type', p_product_type, true),
      (5, 'pattern',      p_pattern,      false),
      (6, 'border',       p_border,       false),
      (7, 'pallu',        p_pallu,        false)
    ) as t(ord, type, code, required)
   where (t.code is null and t.required)
      or (t.code is not null and not exists (
            select 1 from public.master_data m
             where m.type   = t.type::public.master_data_type
               and m.code   = t.code
               and m.status = 'named'
               and m.active
          ));
$$;

grant execute on function
  app.compute_mrp(numeric, numeric, integer),
  app.compose_intake_sku(text, text, text, text, bigint, text),
  app.intake_mrp(numeric),
  app.missing_intake_vocabulary(text, text, text, text, text, text, text)
to authenticated;

-- -----------------------------------------------------------------------------
-- Triggers
-- -----------------------------------------------------------------------------

-- The guard. SECURITY INVOKER on purpose, because the question it asks is "who
-- is writing": `current_user` is `authenticated` for a statement arriving from
-- PostgREST, and is the function OWNER for a statement inside a SECURITY
-- DEFINER function. So the workflow functions below pass through, and a direct
-- UPDATE from a signed-in session is examined. The service role (the n8n
-- pipeline, when it is wired) passes through too — it already carries
-- BYPASSRLS, and the pipeline is the thing that legitimately writes
-- SHOPIFY_CREATED.
--
-- Admin passes through: 022 promises the owner may correct anything at any time,
-- and this migration keeps that promise rather than quietly narrowing it.
create or replace function app.guard_intake_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user <> 'authenticated' or (select app.is_admin()) then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- A saree is born a DRAFT or NEW, with no SKU and no decision. A SKU typed
    -- by a client could claim any weaver's prefix; the database mints it.
    if new.status not in ('DRAFT', 'NEW')
       or new.sku is not null
       or new.approval_status <> 'PENDING'
       or new.approved_by is not null
       or new.approved_at is not null
       or new.publish_status <> 'NOT_PUBLISHED'
       or new.published_at is not null
       or new.img_status <> 'SHOOT_PENDING'
       or new.image_count <> 0
    then
      raise exception 'A new saree starts as a draft or a submission; its SKU and every later status are set by the workflow.'
        using errcode = 'insufficient_privilege';
    end if;

    -- "Mine" means something only if nobody can file a saree under a colleague.
    new.submitted_by := coalesce(new.submitted_by, (select auth.uid()));
    if new.submitted_by is distinct from (select auth.uid()) then
      raise exception 'A saree is submitted in your own name.'
        using errcode = 'insufficient_privilege';
    end if;

    return new;
  end if;

  -- UPDATE. The workflow columns move only through transition_intake / save_intake.
  if new.status           is distinct from old.status
     or new.approval_status  is distinct from old.approval_status
     or new.approved_by      is distinct from old.approved_by
     or new.approved_at      is distinct from old.approved_at
     or new.rejection_reason is distinct from old.rejection_reason
     or new.publish_status   is distinct from old.publish_status
     or new.published_at     is distinct from old.published_at
     or new.img_status       is distinct from old.img_status
     or new.image_count      is distinct from old.image_count
     or new.sku              is distinct from old.sku
     or new.unique_code      is distinct from old.unique_code
     or new.intake_key       is distinct from old.intake_key
     or new.submitted_by     is distinct from old.submitted_by
  then
    raise exception 'Status, SKU and approval change only through the intake workflow.'
      using errcode = 'insufficient_privilege',
            hint    = 'Use the actions on the intake, shooting or review screens.';
  end if;

  -- Once a SKU exists it has been written onto the fabric by hand. Changing the
  -- weaver or a coded attribute underneath it would leave the chalk and the
  -- database describing two different sarees.
  if old.sku is not null and (
       new.vendor_id          is distinct from old.vendor_id
       or new.collection_code is distinct from old.collection_code
       or new.fabric_code     is distinct from old.fabric_code
       or new.colour_code     is distinct from old.colour_code
     )
  then
    raise exception 'SKU % is already on the fabric; its weaver, collection, fabric and colour cannot change. Ask the owner to correct it.', old.sku
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

grant execute on function app.guard_intake_write() to authenticated;

create trigger product_intakes_guard
  before insert or update on product_intakes
  for each row execute function app.guard_intake_write();

-- The timeline. Rebuilt from OLD on every write, so it is append-only whoever
-- is writing. A note (a rejection reason, say) arrives through a
-- transaction-local setting that the workflow functions set and clear; a client
-- that set it by hand could only annotate its own legitimate transition.
create or replace function app.record_intake_history()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_entry jsonb := jsonb_strip_nulls(jsonb_build_object(
    'status', new.status,
    'at',     now(),
    'by',     (select auth.uid()),
    'note',   nullif(current_setting('app.intake_note', true), '')
  ));
begin
  if tg_op = 'INSERT' then
    new.status_history := jsonb_build_array(v_entry);
  elsif new.status is distinct from old.status then
    new.status_history := old.status_history || jsonb_build_array(v_entry);
  else
    new.status_history := old.status_history;
  end if;
  return new;
end;
$$;

grant execute on function app.record_intake_history() to authenticated;

create trigger product_intakes_history
  before insert or update on product_intakes
  for each row execute function app.record_intake_history();

-- A cost price corrected by hand re-prices the saree, unless the same statement
-- set the MRP explicitly (an admin overriding the formula). An insert with no
-- MRP is priced too, so a fixture or script cannot create an unpriced saree.
create or replace function app.price_intake()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.mrp is null
     or (tg_op = 'UPDATE'
         and new.cost_price is distinct from old.cost_price
         and new.mrp is not distinct from old.mrp)
  then
    new.mrp := app.intake_mrp(new.cost_price);
  end if;
  return new;
end;
$$;

grant execute on function app.price_intake() to authenticated;

create trigger product_intakes_price
  before insert or update of cost_price, mrp on product_intakes
  for each row execute function app.price_intake();

-- The vocabulary trigger from 022, narrowed to the moment a code is INTRODUCED.
--
-- 022 fires it on `update of ... status`, so that promoting a DRAFT is checked.
-- But that also re-checks every code on every status change — and now that
-- status changes (shot, sent to review, approved) happen daily, retiring a
-- fabric at /admin/master-data would freeze every saree already carrying it
-- mid-shoot, with an error about vocabulary on a "Mark shot" button. Retiring
-- a value is documented as "stop offering it at intake while every SKU that
-- used it keeps resolving"; this makes that true.
--
-- The guarantee is unchanged: a code still cannot enter a non-draft row — by
-- insert, by editing a code, or by leaving DRAFT — unless it is named and active.
drop trigger if exists product_intakes_vocabulary on product_intakes;

create trigger product_intakes_vocabulary_insert
  before insert on product_intakes
  for each row
  when (new.status <> 'DRAFT')
  execute function app.validate_intake_vocabulary();

create trigger product_intakes_vocabulary_update
  before update of
    collection_code, fabric_code, colour_code, product_type_code,
    pattern_code, border_code, pallu_code, status
  on product_intakes
  for each row
  when (
    new.status <> 'DRAFT'
    and (
      old.status = 'DRAFT'
      or new.collection_code   is distinct from old.collection_code
      or new.fabric_code       is distinct from old.fabric_code
      or new.colour_code       is distinct from old.colour_code
      or new.product_type_code is distinct from old.product_type_code
      or new.pattern_code      is distinct from old.pattern_code
      or new.border_code       is distinct from old.border_code
      or new.pallu_code        is distinct from old.pallu_code
    )
  )
  execute function app.validate_intake_vocabulary();

-- -----------------------------------------------------------------------------
-- Read helpers for the intake screens
-- -----------------------------------------------------------------------------
-- The warehouse manager cannot read `vendors`, `app_users` or `app_settings`,
-- and should not be given a policy on any of them: vendors carries WhatsApp
-- numbers, app_users carries phone numbers, and app_settings carries
-- integration configuration. What the intake screens need from each is a few
-- columns, so each is one narrow SECURITY DEFINER function returning exactly
-- those columns to staff (and to the developer, who reads everything).

create or replace function public.intake_form_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_context jsonb;
begin
  if not ((select app.is_staff()) or (select app.is_developer())) then
    raise exception 'Only Nerige staff can open intake.'
      using errcode = 'insufficient_privilege';
  end if;

  select jsonb_build_object(
    'vendors', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id',             v.id,
               'code',           v.code,
               'display_name',   v.display_name,
               'status',         v.status,
               'is_placeholder', v.is_placeholder
             ) order by v.code)
        from public.vendors v
       where v.deleted_at is null
    ), '[]'::jsonb),
    'mrp_markup_multiplier',      s.mrp_markup_multiplier,
    'mrp_rounding_nearest',       s.mrp_rounding_nearest,
    'image_min_count_for_review', s.image_min_count_for_review,
    'currency',                   s.currency,
    'sku_separator',              s.sku_separator
  )
  into v_context
  from public.app_settings s
  where s.id = 1;

  return v_context;
end;
$$;

comment on function public.intake_form_context() is
  'Vendors (id, code, name, status, placeholder flag) and the pricing settings the intake screens need, for staff who cannot read vendors or app_settings directly.';

create or replace function public.intake_people(p_ids uuid[])
returns table (id uuid, full_name text, role public.app_role)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not ((select app.is_staff()) or (select app.is_developer())) then
    raise exception 'Only Nerige staff can read this.'
      using errcode = 'insufficient_privilege';
  end if;

  return query
    select u.id, u.full_name, u.role
      from public.app_users u
     where u.id = any (p_ids);
end;
$$;

comment on function public.intake_people(uuid[]) is
  'Names and roles for the people on an intake timeline. Nothing else from app_users.';

-- -----------------------------------------------------------------------------
-- save_intake — submission, draft, and the atomic SKU
-- -----------------------------------------------------------------------------
-- One function for three cases, keyed on the idempotency key the form generated
-- when it rendered:
--
--   * no row with this key          -> create it: a DRAFT, or a saree with its
--                                      SKU and status SKU_CREATED in the same
--                                      INSERT, so no reader ever sees a
--                                      submitted saree without its SKU.
--   * a DRAFT with this key         -> update it; promote it to SKU_CREATED
--                                      when it is no longer a draft.
--   * anything else with this key   -> a repeat. Return what exists, change
--                                      nothing. This is the double-tap on a
--                                      slow connection.
--
-- The Unique Code is allocated here with nextval() rather than by the insert
-- trigger, because the SKU needs it in the same statement. The trigger honours
-- a supplied code, so both paths remain valid. Two things protect the series
-- from gaps: vocabulary is checked BEFORE nextval (see missing_intake_vocabulary),
-- and a transaction-scoped advisory lock on the key makes a simultaneous
-- double-submit wait for the first rather than race it into a burned code.
create or replace function public.save_intake(
  p_intake_key        text,
  p_vendor_id         uuid,
  p_collection_code   text,
  p_fabric_code       text,
  p_colour_code       text,
  p_product_type_code text,
  p_pattern_code      text,
  p_border_code       text,
  p_pallu_code        text,
  p_cost_price        numeric,
  p_as_draft          boolean default false,
  p_draft_note        text    default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key       text := trim(coalesce(p_intake_key, ''));
  v_uid       uuid := (select auth.uid());
  v_vendor    public.vendors%rowtype;
  v_existing  public.product_intakes%rowtype;
  v_sep       text;
  v_missing   text[];
  v_code      bigint;
  v_sku       text;
  v_note      text := nullif(trim(coalesce(p_draft_note, '')), '');
  -- Normalised once. A blank optional select arrives as '' from a form.
  v_coll      text := nullif(upper(trim(coalesce(p_collection_code, ''))), '');
  v_fab       text := nullif(upper(trim(coalesce(p_fabric_code, ''))), '');
  v_col       text := nullif(upper(trim(coalesce(p_colour_code, ''))), '');
  v_type      text := nullif(upper(trim(coalesce(p_product_type_code, ''))), '');
  v_pattern   text := nullif(upper(trim(coalesce(p_pattern_code, ''))), '');
  v_border    text := nullif(upper(trim(coalesce(p_border_code, ''))), '');
  v_pallu     text := nullif(upper(trim(coalesce(p_pallu_code, ''))), '');
begin
  if not (select app.can_submit_intake()) then
    raise exception 'Only the warehouse manager or the owner can submit a saree.'
      using errcode = 'insufficient_privilege';
  end if;

  if v_key = '' then
    raise exception 'This form has no submission key. Reload the page and try again.'
      using errcode = 'check_violation';
  end if;

  if p_cost_price is null or p_cost_price <= 0 then
    raise exception 'Enter the cost price.' using errcode = 'check_violation';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('product_intake:' || v_key, 0));

  select * into v_existing
    from public.product_intakes
   where intake_key = v_key
   for update;

  if v_existing.unique_code is not null and v_existing.status <> 'DRAFT' then
    return jsonb_build_object(
      'unique_code', v_existing.unique_code,
      'sku',         v_existing.sku,
      'status',      v_existing.status,
      'outcome',     'repeat'
    );
  end if;

  if v_existing.unique_code is not null
     and not (select app.is_admin())
     and v_existing.submitted_by is distinct from v_uid
  then
    raise exception 'This draft belongs to someone else.'
      using errcode = 'insufficient_privilege';
  end if;

  -- The weaver. Not the holding pen (it is nobody), not an archived house.
  -- Checked after the repeat test, so a double-tap still answers with the SKU
  -- even if the weaver was archived in between.
  select * into v_vendor
    from public.vendors
   where id = p_vendor_id
     and deleted_at is null;
  if v_vendor.id is null or v_vendor.is_placeholder or v_vendor.status = 'archived' then
    raise exception 'Choose the weaver who made this saree.'
      using errcode = 'foreign_key_violation';
  end if;

  if coalesce(p_as_draft, false) then
    -- A draft may be missing the value it is waiting for. The columns are NOT
    -- NULL, so a missing required code is held as '?', which no master_data code
    -- can be (the code CHECK requires a leading letter or digit).
    if v_note is null then
      raise exception 'Say what is missing, so the owner can add it.'
        using errcode = 'check_violation';
    end if;

    if v_existing.unique_code is null then
      insert into public.product_intakes (
        intake_key, status, vendor_id,
        collection_code, fabric_code, colour_code, product_type_code,
        pattern_code, border_code, pallu_code,
        cost_price, mrp, submitted_by, draft_note
      ) values (
        v_key, 'DRAFT', v_vendor.id,
        coalesce(v_coll, '?'), coalesce(v_fab, '?'), coalesce(v_col, '?'), coalesce(v_type, '?'),
        v_pattern, v_border, v_pallu,
        p_cost_price, app.intake_mrp(p_cost_price), v_uid, v_note
      )
      returning * into v_existing;
    else
      update public.product_intakes
         set vendor_id         = v_vendor.id,
             collection_code   = coalesce(v_coll, '?'),
             fabric_code       = coalesce(v_fab, '?'),
             colour_code       = coalesce(v_col, '?'),
             product_type_code = coalesce(v_type, '?'),
             pattern_code      = v_pattern,
             border_code       = v_border,
             pallu_code        = v_pallu,
             cost_price        = p_cost_price,
             mrp               = app.intake_mrp(p_cost_price),
             draft_note        = v_note
       where unique_code = v_existing.unique_code
      returning * into v_existing;
    end if;

    return jsonb_build_object(
      'unique_code', v_existing.unique_code,
      'sku',         null,
      'status',      v_existing.status,
      'outcome',     'draft_saved'
    );
  end if;

  -- A real submission: every code must be offered at intake. Checked here, and
  -- again by the vocabulary trigger, which remains the guarantee.
  v_missing := app.missing_intake_vocabulary(v_coll, v_fab, v_col, v_type, v_pattern, v_border, v_pallu);
  if cardinality(v_missing) > 0 then
    raise exception 'Not in master data yet: %. Save it as a draft and say what is missing.',
      array_to_string(v_missing, ', ')
      using errcode = 'foreign_key_violation';
  end if;

  select coalesce(nullif(s.sku_separator, ''), '-') into v_sep
    from public.app_settings s where s.id = 1;

  if v_existing.unique_code is null then
    v_code := nextval('public.product_seq');
    v_sku  := app.compose_intake_sku(v_vendor.code, v_coll, v_fab, v_col, v_code, v_sep);

    insert into public.product_intakes (
      unique_code, sku, intake_key, status, vendor_id,
      collection_code, fabric_code, colour_code, product_type_code,
      pattern_code, border_code, pallu_code,
      cost_price, mrp, submitted_by
    ) values (
      v_code, v_sku, v_key, 'SKU_CREATED', v_vendor.id,
      v_coll, v_fab, v_col, v_type,
      v_pattern, v_border, v_pallu,
      p_cost_price, app.intake_mrp(p_cost_price), v_uid
    )
    returning * into v_existing;

    return jsonb_build_object(
      'unique_code', v_existing.unique_code,
      'sku',         v_existing.sku,
      'status',      v_existing.status,
      'outcome',     'created'
    );
  end if;

  -- Promoting a draft keeps the code it was allocated when it was first saved.
  v_sku := app.compose_intake_sku(v_vendor.code, v_coll, v_fab, v_col, v_existing.unique_code, v_sep);

  update public.product_intakes
     set vendor_id         = v_vendor.id,
         collection_code   = v_coll,
         fabric_code       = v_fab,
         colour_code       = v_col,
         product_type_code = v_type,
         pattern_code      = v_pattern,
         border_code       = v_border,
         pallu_code        = v_pallu,
         cost_price        = p_cost_price,
         mrp               = app.intake_mrp(p_cost_price),
         sku               = v_sku,
         status            = 'SKU_CREATED'
   where unique_code = v_existing.unique_code
  returning * into v_existing;

  return jsonb_build_object(
    'unique_code', v_existing.unique_code,
    'sku',         v_existing.sku,
    'status',      v_existing.status,
    'outcome',     'promoted'
  );
end;
$$;

comment on function public.save_intake(text, uuid, text, text, text, text, text, text, text, numeric, boolean, text) is
  'Submits a saree (SKU and SKU_CREATED in one statement), saves or promotes a DRAFT, or returns the existing row for a repeated intake_key. Guarded by app.can_submit_intake().';

-- -----------------------------------------------------------------------------
-- transition_intake — the only way status moves for a person
-- -----------------------------------------------------------------------------
-- The transition table, stated once. `src/lib/intake/transitions.ts` mirrors it
-- so the screens offer only buttons that will work; this is the one that is
-- enforced.
--
--   from                                   to                 who
--   SKU_CREATED                            READY_FOR_SHOOT    submit
--   SKU_CREATED, READY_FOR_SHOOT           SHOOT_PENDING      submit   "shot"
--   SHOOT_PENDING, IMAGES_RECEIVED         IMAGES_RECEIVED    submit   count >= 1
--   READY_FOR_REVIEW                       IMAGES_RECEIVED    submit   pull back
--   SHOOT_PENDING, IMAGES_RECEIVED         READY_FOR_REVIEW   submit   count >= min
--   READY_FOR_REVIEW                       APPROVED           review
--   READY_FOR_REVIEW                       REJECTED           review   reason
--   REJECTED                               READY_FOR_SHOOT    submit   reshoot
--
-- "submit" is app.can_submit_intake() (admin, warehouse_manager); "review" is
-- app.can_review_intake() (admin, procurement_head). The shooting edges admit
-- ANY warehouse manager, not only the submitter: shooting is shared floor work,
-- whereas 022's own-submission rule is about correcting what somebody typed.
--
-- `p_from` makes a double-tap harmless: if the saree is already where the
-- caller wanted it, the call returns quietly; if it has moved somewhere else,
-- it says so instead of applying a stale decision.
create or replace function public.transition_intake(
  p_unique_code bigint,
  p_to          public.intake_status,
  p_from        public.intake_status default null,
  p_image_count integer default null,
  p_reason      text    default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_submit boolean := (select app.can_submit_intake());
  v_review boolean := (select app.can_review_intake());
  v_uid    uuid    := (select auth.uid());
  v_row    public.product_intakes%rowtype;
  v_reason text    := nullif(trim(coalesce(p_reason, '')), '');
  v_min    integer;
  v_count  integer;
  v_needs  text;   -- 'submit' | 'review'
begin
  if not (v_submit or v_review) then
    raise exception 'You cannot move a saree through intake.'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_row
    from public.product_intakes
   where unique_code = p_unique_code
   for update;
  if v_row.unique_code is null then
    raise exception 'No saree with code %.', p_unique_code using errcode = 'no_data_found';
  end if;

  if p_from is not null and v_row.status <> p_from then
    if v_row.status = p_to then
      return jsonb_build_object('unique_code', v_row.unique_code, 'status', v_row.status, 'outcome', 'already');
    end if;
    raise exception 'This saree has moved on: it is now %.', v_row.status
      using errcode = 'check_violation';
  end if;

  v_needs := case
    when p_to = 'READY_FOR_SHOOT'  and v_row.status in ('SKU_CREATED', 'REJECTED')                  then 'submit'
    when p_to = 'SHOOT_PENDING'    and v_row.status in ('SKU_CREATED', 'READY_FOR_SHOOT')           then 'submit'
    when p_to = 'IMAGES_RECEIVED'  and v_row.status in ('SHOOT_PENDING', 'IMAGES_RECEIVED', 'READY_FOR_REVIEW') then 'submit'
    when p_to = 'READY_FOR_REVIEW' and v_row.status in ('SHOOT_PENDING', 'IMAGES_RECEIVED')         then 'submit'
    when p_to in ('APPROVED', 'REJECTED') and v_row.status = 'READY_FOR_REVIEW'                     then 'review'
  end;

  if v_needs is null then
    raise exception 'A saree that is % cannot be moved to %.', v_row.status, p_to
      using errcode = 'check_violation';
  end if;

  -- Separation of duties, the whole point of this function. The warehouse
  -- manager does not hold review; procurement does not hold the shoot.
  if (v_needs = 'submit' and not v_submit) or (v_needs = 'review' and not v_review) then
    raise exception '%',
      case v_needs
        when 'review' then 'Approval is for procurement or the owner — not the person who submitted or shot the saree.'
        else 'Only the warehouse manager or the owner moves a saree through the shoot.'
      end
      using errcode = 'insufficient_privilege';
  end if;

  if p_image_count is not null and p_image_count < 0 then
    raise exception 'An image count cannot be negative.' using errcode = 'check_violation';
  end if;

  select greatest(1, s.image_min_count_for_review) into v_min
    from public.app_settings s where s.id = 1;
  v_count := coalesce(p_image_count, v_row.image_count);

  perform set_config('app.intake_note', coalesce(v_reason, ''), true);

  if p_to = 'READY_FOR_SHOOT' then
    -- From REJECTED this is the reshoot. The decision is cleared so the saree can
    -- be decided again; the reason stays in rejection_reason and on the timeline.
    update public.product_intakes
       set status          = 'READY_FOR_SHOOT',
           img_status      = 'SHOOT_PENDING',
           image_count     = case when v_row.status = 'REJECTED' then 0 else image_count end,
           approval_status = 'PENDING',
           approved_by     = null,
           approved_at     = null
     where unique_code = p_unique_code
    returning * into v_row;

  elsif p_to = 'SHOOT_PENDING' then
    update public.product_intakes
       set status     = 'SHOOT_PENDING',
           img_status = 'SHOOT_PENDING'
     where unique_code = p_unique_code
    returning * into v_row;

  elsif p_to = 'IMAGES_RECEIVED' then
    if v_row.status <> 'READY_FOR_REVIEW' and v_count < 1 then
      raise exception 'Record how many photographs were taken.' using errcode = 'check_violation';
    end if;
    update public.product_intakes
       set status      = 'IMAGES_RECEIVED',
           img_status  = 'IMAGES_RECEIVED',
           image_count = v_count
     where unique_code = p_unique_code
    returning * into v_row;

  elsif p_to = 'READY_FOR_REVIEW' then
    if v_count < v_min then
      raise exception 'At least % photograph(s) are needed before review; % recorded.', v_min, v_count
        using errcode = 'check_violation';
    end if;
    update public.product_intakes
       set status      = 'READY_FOR_REVIEW',
           img_status  = 'READY_FOR_REVIEW',
           image_count = v_count
     where unique_code = p_unique_code
    returning * into v_row;

  elsif p_to = 'APPROVED' then
    update public.product_intakes
       set status          = 'APPROVED',
           approval_status = 'APPROVED',
           approved_by     = v_uid,
           approved_at     = now()
     where unique_code = p_unique_code
    returning * into v_row;

  elsif p_to = 'REJECTED' then
    if v_reason is null then
      raise exception 'Say why it is rejected, so the warehouse knows what to fix.'
        using errcode = 'check_violation';
    end if;
    -- approved_by / approved_at record who DECIDED and when, for a rejection as
    -- for an approval: 022 has no separate decided_by, and a rejection with no
    -- name against it is the audit gap that constraint exists to prevent.
    update public.product_intakes
       set status           = 'REJECTED',
           approval_status  = 'REJECTED',
           rejection_reason = v_reason,
           approved_by      = v_uid,
           approved_at      = now()
     where unique_code = p_unique_code
    returning * into v_row;
  end if;

  perform set_config('app.intake_note', '', true);

  return jsonb_build_object('unique_code', v_row.unique_code, 'status', v_row.status, 'outcome', 'moved');
end;
$$;

comment on function public.transition_intake(bigint, public.intake_status, public.intake_status, integer, text) is
  'Moves a saree one edge through the intake lifecycle. Holds the transition table and the separation of duties: submit roles shoot, review roles decide.';

-- Execute rights, stated. PUBLIC holds EXECUTE on a new function by default, and
-- `anon` must reach none of these.
revoke all on function public.intake_form_context()           from public, anon;
revoke all on function public.intake_people(uuid[])           from public, anon;
revoke all on function public.save_intake(text, uuid, text, text, text, text, text, text, text, numeric, boolean, text) from public, anon;
revoke all on function public.transition_intake(bigint, public.intake_status, public.intake_status, integer, text) from public, anon;

grant execute on function public.intake_form_context()        to authenticated;
grant execute on function public.intake_people(uuid[])        to authenticated;
grant execute on function public.save_intake(text, uuid, text, text, text, text, text, text, text, numeric, boolean, text) to authenticated;
grant execute on function public.transition_intake(bigint, public.intake_status, public.intake_status, integer, text) to authenticated;
