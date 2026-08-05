-- =============================================================================
-- M5 / 010 — Goods receipt: the count that turns a parcel into a fact
-- =============================================================================
-- The warehouse manager's entire job in this system is one screen: open the
-- order that arrived, count what is in the box, save. Everything downstream —
-- whether the vendor delivered in full, whether the bill is payable, what the
-- order actually cost — is derived from that count. So the count has to be
-- easy, and once saved it has to be immutable.
--
-- Three decisions worth stating:
--
-- 1. A receipt is a DOCUMENT, not a field on the order. Vendors ship in parts;
--    a saree order arrives as two parcels a week apart. Storing "quantity
--    received" on the PO line alone would lose the fact that there were two
--    events, on two dates, counted by two people.
--
-- 2. Posting is one-way. A draft receipt can be corrected while the parcel is
--    still open on the table. Once posted it is evidence, and evidence that can
--    be edited is not evidence. Corrections happen by posting another receipt.
--
-- 3. `source` distinguishes a count made here from one ingested out of an
--    existing WMS. Everything downstream reads one table either way, so
--    adopting an ERP later changes an adapter rather than the schema.
-- =============================================================================

create type receipt_status as enum ('draft', 'posted', 'cancelled');

-- Where the count came from. 'portal' is our own receiving screen.
create type receipt_source as enum ('portal', 'erp');

-- -----------------------------------------------------------------------------
-- goods_receipts
-- -----------------------------------------------------------------------------
create table goods_receipts (
  id                uuid           primary key default gen_random_uuid(),
  vendor_id         uuid           not null references vendors (id) on delete restrict,
  purchase_order_id uuid           not null references purchase_orders (id) on delete restrict,
  grn_number        text           not null,

  status            receipt_status not null default 'draft',
  source            receipt_source not null default 'portal',

  -- When the goods physically arrived, which is not when someone got round to
  -- counting them. Defaults to now but is editable while the receipt is a draft.
  received_on       date           not null default current_date,
  received_by       uuid           references app_users (id),

  -- What was on the outside of the consignment. Checked against the PO's
  -- dispatch details; a mismatch is the first sign a parcel went missing.
  parcel_count      integer        check (parcel_count is null or parcel_count > 0),
  docket_number     text,

  notes             text,
  posted_at         timestamptz,

  created_at        timestamptz    not null default now(),
  updated_at        timestamptz    not null default now(),
  deleted_at        timestamptz,
  version           integer        not null default 1,

  constraint goods_receipts_posted_stamped
    check ((status = 'posted') = (posted_at is not null))
);

create unique index goods_receipts_number_uniq on goods_receipts (grn_number);
create index goods_receipts_po_idx     on goods_receipts (purchase_order_id) where deleted_at is null;
create index goods_receipts_vendor_idx on goods_receipts (vendor_id) where deleted_at is null;
-- The warehouse's own queue: what have I started counting and not finished.
create index goods_receipts_open_idx
  on goods_receipts (status, received_on desc) where deleted_at is null and status = 'draft';

create trigger goods_receipts_touch
  before update on goods_receipts
  for each row execute function app.touch_row();
create trigger goods_receipts_no_hard_delete
  before delete on goods_receipts
  for each row execute function app.forbid_hard_delete();

comment on table goods_receipts is
  'One counting event against one purchase order. Posting is irreversible; corrections are made by posting a further receipt.';

-- -----------------------------------------------------------------------------
-- goods_receipt_lines
-- -----------------------------------------------------------------------------
create table goods_receipt_lines (
  id                     uuid        primary key default gen_random_uuid(),
  goods_receipt_id       uuid        not null references goods_receipts (id) on delete restrict,
  vendor_id              uuid        not null references vendors (id) on delete restrict,
  purchase_order_line_id uuid        not null references purchase_order_lines (id) on delete restrict,

  -- Set once the SKU exists. On a new-design line it is NULL until Procurement
  -- creates the product, which normally happens on this very screen: the
  -- warehouse is looking at the physical piece, so this is the first moment the
  -- SKU can honestly be assigned.
  product_id             uuid        references products (id) on delete restrict,

  -- Snapshot of what was asked for, so the receipt still reads correctly if the
  -- order is later amended.
  quantity_ordered       integer     not null check (quantity_ordered >= 0),
  -- Pieces that are good and sellable. This is the number that drives payment.
  quantity_received      integer     not null default 0 check (quantity_received >= 0),
  -- Pieces that arrived but are stained, torn or wrongly woven. Counted
  -- separately rather than simply omitted, because "you sent 8 damaged" is a
  -- different conversation from "you sent 8 short", and only the first one
  -- earns a debit note.
  quantity_damaged       integer     not null default 0 check (quantity_damaged >= 0),
  notes                  text,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  deleted_at             timestamptz,
  version                integer     not null default 1
);

create unique index grn_lines_one_per_po_line
  on goods_receipt_lines (goods_receipt_id, purchase_order_line_id) where deleted_at is null;
create index grn_lines_receipt_idx on goods_receipt_lines (goods_receipt_id) where deleted_at is null;
create index grn_lines_po_line_idx on goods_receipt_lines (purchase_order_line_id) where deleted_at is null;
create index grn_lines_vendor_idx  on goods_receipt_lines (vendor_id) where deleted_at is null;

create trigger grn_lines_touch
  before update on goods_receipt_lines
  for each row execute function app.touch_row();
create trigger grn_lines_no_hard_delete
  before delete on goods_receipt_lines
  for each row execute function app.forbid_hard_delete();

-- -----------------------------------------------------------------------------
-- Consistency
-- -----------------------------------------------------------------------------
create or replace function app.grn_assign_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po_vendor uuid;
  v_po_status public.po_status;
begin
  select po.vendor_id, po.status into v_po_vendor, v_po_status
    from public.purchase_orders po
   where po.id = new.purchase_order_id;

  if v_po_vendor is null then
    raise exception 'Purchase order % does not exist.', new.purchase_order_id
      using errcode = 'foreign_key_violation';
  end if;

  new.vendor_id := v_po_vendor;

  if new.grn_number is null or new.grn_number = '' then
    new.grn_number := app.next_document_number('GRN');
  end if;

  -- Counting stock against an order the vendor has not been told about means
  -- the parcel belongs to a different order, or to no order at all.
  if tg_op = 'INSERT' and v_po_status in ('draft', 'cancelled') then
    raise exception 'Purchase order is % — nothing can be received against it.', v_po_status
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger goods_receipts_assign_number_trg
  before insert on goods_receipts
  for each row execute function app.grn_assign_number();

create or replace function app.grn_line_inherit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_line record;
  v_receipt record;
begin
  select gr.id, gr.vendor_id, gr.purchase_order_id, gr.status
    into v_receipt
    from public.goods_receipts gr
   where gr.id = new.goods_receipt_id;

  if v_receipt.id is null then
    raise exception 'Goods receipt % does not exist.', new.goods_receipt_id
      using errcode = 'foreign_key_violation';
  end if;

  -- A posted receipt is evidence. Adding to it after the fact would rewrite
  -- what was counted on the day.
  if v_receipt.status <> 'draft' then
    raise exception 'Goods receipt is % and can no longer be edited.', v_receipt.status
      using errcode = 'check_violation';
  end if;

  select l.id, l.purchase_order_id, l.quantity, l.product_id
    into v_line
    from public.purchase_order_lines l
   where l.id = new.purchase_order_line_id
     and l.deleted_at is null;

  if v_line.id is null then
    raise exception 'Purchase order line % does not exist.', new.purchase_order_line_id
      using errcode = 'foreign_key_violation';
  end if;

  -- The line being counted must belong to the order being received against.
  -- Without this a receipt could credit units to another vendor's order.
  if v_line.purchase_order_id <> v_receipt.purchase_order_id then
    raise exception 'That line belongs to a different purchase order.'
      using errcode = 'foreign_key_violation';
  end if;

  new.vendor_id        := v_receipt.vendor_id;
  new.quantity_ordered := v_line.quantity;
  new.product_id       := coalesce(new.product_id, v_line.product_id);

  return new;
end;
$$;

create trigger grn_lines_inherit_trg
  before insert or update on goods_receipt_lines
  for each row execute function app.grn_line_inherit();

-- -----------------------------------------------------------------------------
-- Posting
-- -----------------------------------------------------------------------------
-- The one moment the count becomes real. Rolls the received quantities up onto
-- the order lines, advances the order's status, and tells everyone.
--
-- SECURITY DEFINER because the warehouse manager legitimately causes writes to
-- purchase_order_lines and purchase_orders — tables they must not be able to
-- edit directly. The privilege is attached to this specific, audited operation
-- rather than granted to the role at large.
create or replace function app.grn_post()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outstanding integer;
  v_lines       integer;
begin
  select count(*) into v_lines
    from public.goods_receipt_lines grl
   where grl.goods_receipt_id = new.id and grl.deleted_at is null;

  if v_lines = 0 then
    raise exception 'Goods receipt % has no counted lines and cannot be posted.', new.grn_number
      using errcode = 'check_violation';
  end if;

  -- Roll the count up. Damaged pieces are deliberately NOT added: they arrived,
  -- but they are not stock and we are not paying for them. They stay on the
  -- receipt line so the shortfall conversation has evidence behind it.
  update public.purchase_order_lines l
     set quantity_received = l.quantity_received + grl.quantity_received
    from public.goods_receipt_lines grl
   where grl.goods_receipt_id = new.id
     and grl.deleted_at is null
     and grl.purchase_order_line_id = l.id;

  -- Anything still outstanding across the whole order?
  select coalesce(sum(greatest(l.quantity - l.quantity_received, 0)), 0)
    into v_outstanding
    from public.purchase_order_lines l
   where l.purchase_order_id = new.purchase_order_id
     and l.deleted_at is null;

  update public.purchase_orders po
     set status = case when v_outstanding = 0 then 'received'::public.po_status
                       else 'partially_received'::public.po_status end
   where po.id = new.purchase_order_id
     -- Every live state, not just 'dispatched': see the transition table in
     -- migration 009 for why a missing dispatch update must not block a count.
     and po.status in ('issued', 'acknowledged', 'in_production',
                       'dispatched', 'partially_received');

  perform app.emit_event(
    'goods_receipt.posted',
    jsonb_build_object(
      'goods_receipt_id',  new.id,
      'grn_number',        new.grn_number,
      'purchase_order_id', new.purchase_order_id,
      'vendor_id',         new.vendor_id,
      'outstanding_units', v_outstanding,
      'actor_id',          auth.uid()
    ),
    new.vendor_id, 'goods_receipt', new.id,
    null,
    'goods_receipt.posted:' || new.id::text
  );

  -- The prompt that closes the loop the business currently loses: stock is in,
  -- so the bill for it is now expected. Without this the parcel is received and
  -- the invoice quietly never arrives.
  perform app.emit_event(
    'purchase_order.bill_expected',
    jsonb_build_object(
      'purchase_order_id', new.purchase_order_id,
      'vendor_id',         new.vendor_id
    ),
    new.vendor_id, 'purchase_order', new.purchase_order_id,
    null,
    'purchase_order.bill_expected:' || new.purchase_order_id::text
  );

  return null;
end;
$$;

create trigger goods_receipts_post_trg
  after update of status on goods_receipts
  for each row
  when (old.status = 'draft' and new.status = 'posted')
  execute function app.grn_post();

-- Stamps posted_at before the CHECK constraint looks for it, and refuses any
-- edit to a receipt that has already been posted.
create or replace function app.grn_guard_status()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'posted' and new.status = 'posted' then
    raise exception 'Goods receipt % is posted and cannot be changed.', old.grn_number
      using errcode = 'check_violation';
  end if;

  if old.status <> 'draft' and new.status <> old.status then
    raise exception 'A % goods receipt cannot become %.', old.status, new.status
      using errcode = 'check_violation';
  end if;

  if new.status = 'posted' and old.status = 'draft' then
    new.posted_at := coalesce(new.posted_at, now());
  end if;

  return new;
end;
$$;

create trigger goods_receipts_guard_status_trg
  before update on goods_receipts
  for each row execute function app.grn_guard_status();

comment on function app.grn_post() is
  'Rolls a posted receipt onto the order lines and advances the order status. Runs as definer so receiving does not require write access to purchase orders.';

select app.enable_audit('goods_receipts');
select app.enable_audit('goods_receipt_lines');
