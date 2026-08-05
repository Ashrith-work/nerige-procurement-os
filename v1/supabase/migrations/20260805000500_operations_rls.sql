-- =============================================================================
-- 012 — Row Level Security for catalogue, orders, receipts and bills
-- =============================================================================
-- M1 gave vendors read-only access, on the principle that a write path without
-- a screen behind it is unearned attack surface. The screens now exist, so this
-- migration opens exactly four vendor write paths and not one more:
--
--   1. acknowledge an order and commit to a date
--   2. record dispatch (transporter, docket, parcel count)
--   3. ask a question on an order
--   4. upload a bill, and correct it until someone starts reviewing it
--
-- Two enforcement layers, deliberately separated:
--
--   * RLS answers "which rows may this session touch at all?"
--   * triggers (migrations 009–011) answer "what may this role do to them?"
--
-- Keeping the state machine out of the policies is what stops the policies
-- becoming an unreadable knot of status predicates that nobody dares change.
-- The cost is that a vendor's UPDATE reaches the row before being refused —
-- so every table a vendor may update also has a column guard below, because
-- Postgres has no column-level RLS and a policy that permits an UPDATE permits
-- it on every column.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Outbox privilege fix
-- -----------------------------------------------------------------------------
-- `events` has RLS on, no policies and no grants — correct, and the reason it
-- must be written through a definer function. app.emit_event() was not one,
-- which meant any trigger calling it from a non-definer context (the vendor
-- bank-account alert in migration 004) would fail with "permission denied for
-- table events" the first time a Procurement Head added a bank account.
--
-- Redefined here rather than edited in place: migration 004 has already run in
-- every environment that exists.
create or replace function app.emit_event(
  p_topic           text,
  p_payload         jsonb   default '{}'::jsonb,
  p_vendor_id       uuid    default null,
  p_aggregate_type  text    default null,
  p_aggregate_id    uuid    default null,
  p_available_at    timestamptz default null,
  p_idempotency_key text    default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.events (
    topic, payload, vendor_id, aggregate_type, aggregate_id,
    available_at, idempotency_key
  ) values (
    p_topic, coalesce(p_payload, '{}'::jsonb), p_vendor_id, p_aggregate_type, p_aggregate_id,
    coalesce(p_available_at, now()), p_idempotency_key
  )
  -- The partial index predicate must be restated for ON CONFLICT to match it.
  on conflict (idempotency_key) where idempotency_key is not null do nothing
  returning id into v_id;

  return v_id;
end;
$$;

comment on function app.emit_event(text, jsonb, uuid, text, uuid, timestamptz, text) is
  'The only way into the outbox. SECURITY DEFINER because `events` has no grants to any client role.';

-- -----------------------------------------------------------------------------
-- Role helpers
-- -----------------------------------------------------------------------------
-- Named for the capability rather than the role, so a future role change is one
-- edit here instead of a search through every policy.

-- Who plans and places orders, and maintains the catalogue.
create or replace function app.can_manage_orders()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(app.current_role() in ('founder', 'procurement_head'), false);
$$;

-- Who may count stock in. Procurement is included deliberately: this is a
-- three-person operation, and blocking Pooja from recording a receipt because
-- the warehouse manager is on leave would send the count straight back to paper.
create or replace function app.can_receive_goods()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(app.current_role() in
    ('founder', 'warehouse_manager', 'procurement_head'), false);
$$;

-- Who may see money owed. The warehouse is excluded: bills are not their job,
-- and the smaller the audience for commercial terms the better.
create or replace function app.can_handle_bills()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(app.current_role() in ('founder', 'procurement_head'), false);
$$;

-- True when the calling vendor is allowed to know this order exists.
--
-- A draft order is Procurement thinking out loud — quantities get halved, lines
-- get deleted, prices get argued about. Showing a vendor a draft would mean
-- them acting on an order we have not sent. The check lives in one definer
-- function so that the orders table, its lines and its message thread cannot
-- drift apart on what "visible" means.
create or replace function app.vendor_can_see_order(p_purchase_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.purchase_orders po
     where po.id = p_purchase_order_id
       and po.deleted_at is null
       and po.status <> 'draft'
       and app.owns_vendor_row(po.vendor_id)
  );
$$;

grant execute on function
  app.can_manage_orders(),
  app.can_receive_goods(),
  app.can_handle_bills(),
  app.vendor_can_see_order(uuid)
to authenticated;

-- -----------------------------------------------------------------------------
-- Enable and force
-- -----------------------------------------------------------------------------
-- FORCE as well as ENABLE, on every table without exception: without it, any
-- connection running as the table owner bypasses every policy silently.
do $$
declare
  t text;
begin
  foreach t in array array[
    'product_series', 'products',
    'purchase_orders', 'purchase_order_lines', 'purchase_order_messages',
    'goods_receipts', 'goods_receipt_lines',
    'vendor_bills'
  ]
  loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Catalogue — the SKU codes vendors print on labels
-- -----------------------------------------------------------------------------
-- Read for everyone who needs it, write for Procurement only. A vendor must be
-- able to look up their codes at any hour without asking; a vendor inventing
-- their own SKU would break the one thing the code is for, which is being the
-- same string on the label, in Shopify and in the warehouse.
do $$
declare
  t text;
begin
  foreach t in array array['product_series', 'products']
  loop
    execute format('grant select, insert, update on %I to authenticated', t);

    execute format($p$
      create policy %I on %I
        for select to authenticated
        using (app.is_internal() and deleted_at is null)
    $p$, t || '_select_internal', t);

    execute format($p$
      create policy %I on %I
        for select to authenticated
        using (app.owns_vendor_row(vendor_id) and deleted_at is null)
    $p$, t || '_select_own', t);

    execute format($p$
      create policy %I on %I
        for insert to authenticated
        with check (app.can_manage_orders())
    $p$, t || '_insert_managed', t);

    execute format($p$
      create policy %I on %I
        for update to authenticated
        using (app.can_manage_orders() and deleted_at is null)
        with check (app.can_manage_orders())
    $p$, t || '_update_managed', t);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- purchase_orders
-- -----------------------------------------------------------------------------
grant select, insert, update on purchase_orders to authenticated;

-- Every internal role reads every order. The warehouse needs to know what is
-- coming; Procurement needs to know what is late; the Founder needs both.
create policy purchase_orders_select_internal on purchase_orders
  for select to authenticated
  using (app.is_internal() and deleted_at is null);

create policy purchase_orders_select_own on purchase_orders
  for select to authenticated
  using (
    app.owns_vendor_row(vendor_id)
    and deleted_at is null
    and status <> 'draft'
  );

create policy purchase_orders_insert_managed on purchase_orders
  for insert to authenticated
  with check (app.can_manage_orders());

create policy purchase_orders_update_managed on purchase_orders
  for update to authenticated
  using  (app.can_manage_orders() and deleted_at is null)
  with check (app.can_manage_orders());

-- The vendor's own write path. Which transitions they may make is decided by
-- app.po_guard_transition(); which columns they may touch, by the guard below.
create policy purchase_orders_update_own on purchase_orders
  for update to authenticated
  using  (app.owns_vendor_row(vendor_id) and deleted_at is null and status <> 'draft')
  with check (app.owns_vendor_row(vendor_id) and status <> 'draft');

-- Pins every column a vendor has no business changing back to its stored value.
--
-- Necessary because RLS is row-level: `purchase_orders_update_own` permits the
-- UPDATE statement, and without this a crafted request could rewrite the order
-- quantity, the required-by date or the total the vendor is about to be paid.
-- Written as explicit assignments rather than anything clever, because the list
-- of what a vendor MAY change is short and worth reading at a glance:
-- status, promised_date, and the three dispatch fields.
create or replace function app.po_pin_vendor_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if app.current_role() is distinct from 'vendor' then
    return new;
  end if;

  new.vendor_id           := old.vendor_id;
  new.po_number           := old.po_number;
  new.title               := old.title;
  new.required_by         := old.required_by;
  new.instructions        := old.instructions;
  new.issued_at           := old.issued_at;
  new.issued_by           := old.issued_by;
  new.received_at         := old.received_at;
  new.closed_at           := old.closed_at;
  new.cancelled_at        := old.cancelled_at;
  new.cancellation_reason := old.cancellation_reason;
  new.subtotal_amount     := old.subtotal_amount;
  new.tax_amount          := old.tax_amount;
  new.total_amount        := old.total_amount;
  new.created_by          := old.created_by;
  new.created_at          := old.created_at;
  new.deleted_at          := old.deleted_at;

  return new;
end;
$$;

-- Fires before app.po_guard_transition() (triggers run in name order), so the
-- transition guard sees the pinned row rather than whatever was submitted.
create trigger purchase_orders_a_pin_vendor_columns_trg
  before update on purchase_orders
  for each row execute function app.po_pin_vendor_columns();

comment on policy purchase_orders_select_own on purchase_orders is
  'A vendor sees their own orders from `issued` onwards. Draft orders are Procurement thinking out loud and must never appear in the portal.';

-- -----------------------------------------------------------------------------
-- purchase_order_lines
-- -----------------------------------------------------------------------------
-- Lines are the offer itself and are never editable by the vendor. A vendor who
-- disagrees with a quantity or a price says so in the message thread, and
-- Procurement amends the order — leaving both versions in the audit trail.
grant select, insert, update on purchase_order_lines to authenticated;

create policy po_lines_select_internal on purchase_order_lines
  for select to authenticated
  using (app.is_internal() and deleted_at is null);

create policy po_lines_select_own on purchase_order_lines
  for select to authenticated
  using (app.vendor_can_see_order(purchase_order_id) and deleted_at is null);

create policy po_lines_insert_managed on purchase_order_lines
  for insert to authenticated
  with check (app.can_manage_orders());

create policy po_lines_update_managed on purchase_order_lines
  for update to authenticated
  using  (app.can_manage_orders() and deleted_at is null)
  with check (app.can_manage_orders());

-- -----------------------------------------------------------------------------
-- purchase_order_messages
-- -----------------------------------------------------------------------------
-- The order thread. No UPDATE or DELETE grant at all: a conversation that can
-- be edited afterwards settles no argument about what was agreed.
grant select, insert on purchase_order_messages to authenticated;

create policy po_messages_select_internal on purchase_order_messages
  for select to authenticated
  using (app.is_internal());

create policy po_messages_select_own on purchase_order_messages
  for select to authenticated
  using (app.vendor_can_see_order(purchase_order_id) and is_internal = false);

create policy po_messages_insert_internal on purchase_order_messages
  for insert to authenticated
  with check (app.is_internal() and author_id = (select auth.uid()));

-- A vendor may write on their own order, and may not write an internal note —
-- which would be invisible to them the moment it was saved.
create policy po_messages_insert_own on purchase_order_messages
  for insert to authenticated
  with check (
    app.vendor_can_see_order(purchase_order_id)
    and is_internal = false
    and author_id = (select auth.uid())
  );

-- -----------------------------------------------------------------------------
-- goods_receipts and goods_receipt_lines
-- -----------------------------------------------------------------------------
-- Vendors can READ what we counted. That is deliberate and slightly unusual:
-- the alternative is the phone call that begins "you said you only got 92".
-- Publishing the count turns a dispute into a shared document.
do $$
declare
  t text;
begin
  foreach t in array array['goods_receipts', 'goods_receipt_lines']
  loop
    execute format('grant select, insert, update on %I to authenticated', t);

    execute format($p$
      create policy %I on %I
        for select to authenticated
        using (app.is_internal() and deleted_at is null)
    $p$, t || '_select_internal', t);

    execute format($p$
      create policy %I on %I
        for select to authenticated
        using (app.owns_vendor_row(vendor_id) and deleted_at is null)
    $p$, t || '_select_own', t);

    execute format($p$
      create policy %I on %I
        for insert to authenticated
        with check (app.can_receive_goods())
    $p$, t || '_insert_receiving', t);

    execute format($p$
      create policy %I on %I
        for update to authenticated
        using (app.can_receive_goods() and deleted_at is null)
        with check (app.can_receive_goods())
    $p$, t || '_update_receiving', t);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- vendor_bills
-- -----------------------------------------------------------------------------
grant select, insert, update on vendor_bills to authenticated;

create policy vendor_bills_select_internal on vendor_bills
  for select to authenticated
  using (app.can_handle_bills() and deleted_at is null);

create policy vendor_bills_select_own on vendor_bills
  for select to authenticated
  using (app.owns_vendor_row(vendor_id) and deleted_at is null);

create policy vendor_bills_insert_internal on vendor_bills
  for insert to authenticated
  with check (app.can_handle_bills());

-- The path that fixes the missing-bill problem: the vendor uploads it against
-- the order themselves, the moment they post the hard copy.
create policy vendor_bills_insert_own on vendor_bills
  for insert to authenticated
  with check (
    app.vendor_can_see_order(purchase_order_id)
    and status = 'submitted'
  );

create policy vendor_bills_update_internal on vendor_bills
  for update to authenticated
  using  (app.can_handle_bills() and deleted_at is null)
  with check (app.can_handle_bills());

-- A vendor may correct their own bill until someone starts reviewing it.
-- app.bill_freeze_after_review() enforces the "until".
create policy vendor_bills_update_own on vendor_bills
  for update to authenticated
  using  (app.owns_vendor_row(vendor_id) and deleted_at is null and status = 'submitted')
  with check (app.owns_vendor_row(vendor_id) and status = 'submitted');

-- Same reasoning as the purchase-order column guard: the settlement fields
-- decide whether money leaves, and an UPDATE policy is not column-aware.
create or replace function app.bill_pin_vendor_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if app.current_role() is distinct from 'vendor' then
    return new;
  end if;

  new.status                 := old.status;
  new.vendor_id              := old.vendor_id;
  new.purchase_order_id      := old.purchase_order_id;
  new.matched_received_value := old.matched_received_value;
  new.variance_note          := old.variance_note;
  new.reviewed_by            := old.reviewed_by;
  new.reviewed_at            := old.reviewed_at;
  new.approved_by            := old.approved_by;
  new.approved_at            := old.approved_at;
  new.paid_at                := old.paid_at;
  new.payment_reference      := old.payment_reference;
  new.submitted_by           := old.submitted_by;
  new.deleted_at             := old.deleted_at;

  return new;
end;
$$;

-- Named to sort LAST among this table's BEFORE triggers (they fire in name
-- order). app.bill_guard_transition() gets to raise a clear "a vendor cannot
-- change the status of a bill" first; pinning before it would silently revert
-- the status instead, and a silent no-op is a support ticket.
create trigger vendor_bills_z_pin_vendor_columns_trg
  before update on vendor_bills
  for each row execute function app.bill_pin_vendor_columns();

-- -----------------------------------------------------------------------------
-- documents — vendors may now attach their own files
-- -----------------------------------------------------------------------------
-- M1 restricted uploads to Procurement because nothing needed them. A bill
-- photographed by the vendor is the whole point of the billing flow, so the
-- metadata row has to be insertable by them — scoped to their own organisation,
-- and to a storage path under their own prefix (the CHECK constraint from
-- migration 004 already guarantees the second part).
create policy documents_insert_own_vendor on documents
  for insert to authenticated
  with check (app.owns_vendor_row(vendor_id));

-- -----------------------------------------------------------------------------
-- Storage — the bytes, not just the metadata
-- -----------------------------------------------------------------------------
-- Locking the documents table while leaving the bucket writable is the classic
-- Supabase half-fix. A vendor may write only under vendors/{their own id}/.
create policy vendor_documents_write_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'vendor-documents'
    and app.owns_vendor_row(app.storage_path_vendor_id(name))
  );

-- Still no DELETE policy for anyone, and none for vendor UPDATE: a bill that
-- can be replaced after submission is not evidence of anything.
