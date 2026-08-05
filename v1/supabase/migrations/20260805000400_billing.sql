-- =============================================================================
-- M6 / 011 — Vendor bills: the hard copy, attached to the order it belongs to
-- =============================================================================
-- The problem in the founder's own words: the bill arrives as a hard copy, gets
-- photographed into WhatsApp, and is stored somewhere else. It goes missing,
-- and nobody can say how much was spent on what.
--
-- The fix is not a filing system. It is refusing to accept a bill that is not
-- attached to a purchase order, and refusing to accept one without the image.
-- Both are enforced here rather than requested politely in the UI:
--
--   * purchase_order_id is NOT NULL — a bill with no order is exactly the
--     unattributable spend this system exists to eliminate
--   * document_id is NOT NULL — a bill with no photograph of the hard copy is a
--     claim, not a record; if the paper is later disputed there is nothing to
--     look at
--
-- The three-way match is the control that makes it worth doing. What was
-- ORDERED, what was RECEIVED and what was BILLED are three different numbers,
-- and the gap between the last two is the money that quietly leaks. The gap is
-- computed and stored at review time so it appears on a list without a join,
-- and so the number a bill was approved against is preserved even if a
-- correcting receipt is posted afterwards.
--
-- Payment timing is statutory, not a preference. `due_date` is derived from the
-- vendor's agreed terms, which migration 002 already caps at 45 days for micro
-- and small MSME suppliers under Income Tax Act s.43B(h). Paying later
-- disallows the expense for the financial year, so the date is computed by the
-- database rather than typed by whoever is entering the bill.
-- =============================================================================

create type bill_status as enum (
  'submitted',    -- uploaded, nobody has looked at it yet
  'under_review', -- Procurement is matching it against the receipt
  'disputed',     -- short delivery, wrong rate, damaged goods billed in full
  'rejected',     -- will not be paid; a duplicate or a bill for another buyer
  'approved',     -- Founder has authorised payment
  'paid'
);

create table vendor_bills (
  id                     uuid           primary key default gen_random_uuid(),
  vendor_id              uuid           not null references vendors (id) on delete restrict,
  purchase_order_id      uuid           not null references purchase_orders (id) on delete restrict,

  -- The number printed on the vendor's own bill book. Not ours, and not unique
  -- across vendors — two vendors will both have a bill "001".
  bill_number            text           not null
                                        check (length(trim(bill_number)) between 1 and 60),
  bill_date              date           not null,

  status                 bill_status    not null default 'submitted',

  subtotal_amount        numeric(14, 2) not null check (subtotal_amount >= 0),
  tax_amount             numeric(14, 2) not null default 0 check (tax_amount >= 0),
  total_amount           numeric(14, 2) not null check (total_amount >= 0),

  -- The photograph of the hard copy. Required — see the header note.
  document_id            uuid           not null references documents (id) on delete restrict,

  -- --- Three-way match -----------------------------------------------------
  -- Value of what was actually counted in at the warehouse for this order.
  -- Recomputed while the bill is still under review, then frozen at approval —
  -- a correcting receipt posted next week must not retroactively change what
  -- the Founder authorised.
  matched_received_value numeric(14, 2),
  variance_amount        numeric(14, 2) generated always as
                           (total_amount - matched_received_value) stored,
  variance_note          text,

  -- --- Settlement ----------------------------------------------------------
  -- Derived from the vendor's agreed payment terms. Never typed by hand.
  due_date               date,
  submitted_by           uuid           references app_users (id),
  reviewed_by            uuid           references app_users (id),
  reviewed_at            timestamptz,
  approved_by            uuid           references app_users (id),
  approved_at            timestamptz,
  paid_at                timestamptz,
  payment_reference      text,

  created_at             timestamptz    not null default now(),
  updated_at             timestamptz    not null default now(),
  deleted_at             timestamptz,
  version                integer        not null default 1,

  constraint vendor_bills_total_adds_up
    check (total_amount = subtotal_amount + tax_amount),
  constraint vendor_bills_approved_pair
    check ((approved_at is null) = (approved_by is null)),
  -- Approval is what authorises money to leave. It must be recorded, not
  -- inferred from a payment that already happened.
  constraint vendor_bills_paid_needs_approval
    check (status <> 'paid' or approved_at is not null)
);

-- The duplicate-bill control. The same vendor cannot submit bill "0042" twice,
-- which is the most common way the same goods get paid for two months running.
create unique index vendor_bills_number_per_vendor
  on vendor_bills (vendor_id, lower(bill_number)) where deleted_at is null;
create index vendor_bills_po_idx     on vendor_bills (purchase_order_id) where deleted_at is null;
create index vendor_bills_vendor_idx on vendor_bills (vendor_id) where deleted_at is null;
-- The ageing query: what is unpaid, oldest due first. Partial, so settled bills
-- fall out of the index entirely.
create index vendor_bills_ageing_idx
  on vendor_bills (due_date, status)
  where deleted_at is null and status not in ('paid', 'rejected');

create trigger vendor_bills_touch
  before update on vendor_bills
  for each row execute function app.touch_row();
create trigger vendor_bills_no_hard_delete
  before delete on vendor_bills
  for each row execute function app.forbid_hard_delete();

comment on table vendor_bills is
  'A vendor bill against one purchase order, with the hard copy attached. Both links are NOT NULL — unattributable spend is the problem this table exists to remove.';
comment on column vendor_bills.variance_amount is
  'Billed minus received value. Positive means we are being asked to pay for goods that were not counted in.';
comment on column vendor_bills.due_date is
  'Derived from the vendor''s agreed terms, which are capped at 45 days for micro/small MSME suppliers (Income Tax Act s.43B(h)).';

-- -----------------------------------------------------------------------------
-- Consistency, matching and the due date
-- -----------------------------------------------------------------------------
-- Runs as definer because it reads `vendors` and the order's lines, which the
-- submitting vendor can see for themselves but whose values must not depend on
-- who is asking.
create or replace function app.bill_prepare()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po_vendor uuid;
  v_po_status public.po_status;
  v_terms     integer;
  v_doc_vendor uuid;
begin
  select po.vendor_id, po.status into v_po_vendor, v_po_status
    from public.purchase_orders po
   where po.id = new.purchase_order_id;

  if v_po_vendor is null then
    raise exception 'Purchase order % does not exist.', new.purchase_order_id
      using errcode = 'foreign_key_violation';
  end if;

  -- Never trust a caller-supplied vendor_id: it decides who can read the bill.
  new.vendor_id := v_po_vendor;

  if tg_op = 'INSERT' and v_po_status in ('draft', 'cancelled') then
    raise exception 'Purchase order is % — a bill cannot be raised against it.', v_po_status
      using errcode = 'check_violation';
  end if;

  -- The attached document must belong to the same vendor. Otherwise a bill
  -- could point at another vendor's file and leak it through the download link.
  select d.vendor_id into v_doc_vendor
    from public.documents d
   where d.id = new.document_id and d.deleted_at is null;

  if v_doc_vendor is distinct from new.vendor_id then
    raise exception 'The attached document does not belong to this vendor.'
      using errcode = 'foreign_key_violation';
  end if;

  -- Payment terms come from the vendor master, where the MSME cap is enforced.
  select v.payment_terms_days into v_terms
    from public.vendors v
   where v.id = new.vendor_id;

  new.due_date := new.bill_date + coalesce(v_terms, 30);

  -- Snapshot the three-way match, but only while the bill is still open to
  -- review. Once the Founder has approved it, the figure the approval was
  -- given against is frozen — a correcting receipt posted next week must not
  -- retroactively change what was authorised.
  if tg_op = 'INSERT' or old.status in ('submitted', 'under_review', 'disputed') then
    -- `quantity_received` excludes damaged pieces, so a bill charging for goods
    -- that arrived unsellable shows as a variance rather than being paid on the
    -- assumption that everything in the box counted.
    select coalesce(sum(
             l.quantity_received * l.unit_price
             + round(l.quantity_received * l.unit_price * l.gst_rate / 100, 2)
           ), 0)
      into new.matched_received_value
      from public.purchase_order_lines l
     where l.purchase_order_id = new.purchase_order_id
       and l.deleted_at is null;
  end if;

  return new;
end;
$$;

create trigger vendor_bills_prepare_trg
  before insert or update on vendor_bills
  for each row execute function app.bill_prepare();

-- -----------------------------------------------------------------------------
-- Who may move a bill, and to where
-- -----------------------------------------------------------------------------
-- The role gate that matters most in the system: approval releases money.
-- Founder only, stated once, in the database, where no client can route around
-- it. RLS decides which bills you can see; this decides what you can do to one.
create or replace function app.bill_guard_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role   public.app_role := app.current_role();
  v_actor  uuid            := auth.uid();
  v_change text            := old.status::text || '->' || new.status::text;
begin
  if new.status = old.status then
    return new;
  end if;

  -- Role first, then legality. A vendor gets told the actual reason they were
  -- refused rather than a transition-table message that invites them to try a
  -- different one; the answer is no for all of them.
  --
  -- A vendor uploads and then waits. They cannot review, approve or settle
  -- their own bill, which would be the whole control defeated.
  if v_role = 'vendor' then
    raise exception 'A vendor cannot change the status of a bill.'
      using errcode = 'insufficient_privilege';
  end if;

  if v_change not in (
    'submitted->under_review',  'submitted->rejected',
    'under_review->disputed',   'under_review->approved', 'under_review->rejected',
    'disputed->under_review',   'disputed->rejected',
    'approved->paid',           'approved->disputed'
  ) then
    raise exception 'A bill cannot go from % to %.', old.status, new.status
      using errcode = 'check_violation';
  end if;

  if new.status in ('approved', 'paid') and v_role is not null and v_role <> 'founder' then
    raise exception 'Only the Founder can approve a bill for payment.'
      using errcode = 'insufficient_privilege';
  end if;

  if v_role = 'warehouse_manager' then
    raise exception 'The warehouse does not handle bills.'
      using errcode = 'insufficient_privilege';
  end if;

  case new.status
    when 'under_review' then
      new.reviewed_by := coalesce(new.reviewed_by, v_actor);
      new.reviewed_at := coalesce(new.reviewed_at, now());
    when 'approved' then
      new.approved_by := coalesce(new.approved_by, v_actor);
      new.approved_at := coalesce(new.approved_at, now());
    when 'paid' then
      new.paid_at     := coalesce(new.paid_at, now());
    else
      null;
  end case;

  return new;
end;
$$;

create trigger vendor_bills_guard_transition_trg
  before update of status on vendor_bills
  for each row execute function app.bill_guard_transition();

-- A vendor may correct a bill they have just uploaded — a mistyped total, the
-- wrong date. Once anyone has begun reviewing it, the figures are frozen: the
-- alternative is a bill whose amount changes after it was matched.
create or replace function app.bill_freeze_after_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'submitted' then
    return new;
  end if;

  if (new.bill_number, new.bill_date, new.subtotal_amount, new.tax_amount,
      new.total_amount, new.document_id)
     is distinct from
     (old.bill_number, old.bill_date, old.subtotal_amount, old.tax_amount,
      old.total_amount, old.document_id)
  then
    raise exception 'Bill % is under review; its figures can no longer be edited.', old.bill_number
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger vendor_bills_freeze_trg
  before update on vendor_bills
  for each row execute function app.bill_freeze_after_review();

-- -----------------------------------------------------------------------------
-- Notifications and order closure
-- -----------------------------------------------------------------------------
create or replace function app.bill_emit_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_topic text;
begin
  if tg_op = 'INSERT' then
    perform app.emit_event(
      'vendor_bill.submitted',
      jsonb_build_object(
        'vendor_bill_id',    new.id,
        'purchase_order_id', new.purchase_order_id,
        'vendor_id',         new.vendor_id,
        'bill_number',       new.bill_number,
        'total_amount',      new.total_amount,
        'variance_amount',   new.variance_amount,
        'due_date',          new.due_date
      ),
      new.vendor_id, 'vendor_bill', new.id,
      null, 'vendor_bill.submitted:' || new.id::text
    );

    -- Payment reminder, a week before the statutory clock runs out. A future
    -- available_at is the whole mechanism — no scheduler, and it is written in
    -- the same transaction as the bill it concerns.
    perform app.emit_event(
      'vendor_bill.payment_due_soon',
      jsonb_build_object(
        'vendor_bill_id', new.id,
        'vendor_id',      new.vendor_id,
        'due_date',       new.due_date
      ),
      new.vendor_id, 'vendor_bill', new.id,
      (new.due_date - 7)::timestamptz,
      'vendor_bill.due_soon:' || new.id::text
    );

    return null;
  end if;

  v_topic := case new.status
    when 'approved' then 'vendor_bill.approved'
    when 'disputed' then 'vendor_bill.disputed'
    when 'rejected' then 'vendor_bill.rejected'
    when 'paid'     then 'vendor_bill.paid'
    else null
  end;

  if v_topic is null then
    return null;
  end if;

  perform app.emit_event(
    v_topic,
    jsonb_build_object(
      'vendor_bill_id',    new.id,
      'purchase_order_id', new.purchase_order_id,
      'vendor_id',         new.vendor_id,
      'bill_number',       new.bill_number,
      'total_amount',      new.total_amount,
      'variance_note',     new.variance_note,
      'actor_id',          auth.uid()
    ),
    new.vendor_id, 'vendor_bill', new.id,
    null, v_topic || ':' || new.id::text
  );

  return null;
end;
$$;

create trigger vendor_bills_emit_event_trg
  after insert or update of status on vendor_bills
  for each row execute function app.bill_emit_event();

-- Settling the bill is what finishes the order. Doing it here rather than
-- asking someone to remember means the open-orders list is trustworthy, and a
-- list nobody trusts is a list nobody uses.
create or replace function app.bill_close_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.purchase_orders po
     set status = 'closed'
   where po.id = new.purchase_order_id
     and po.status in ('received', 'partially_received');
  return null;
end;
$$;

create trigger vendor_bills_close_order_trg
  after update of status on vendor_bills
  for each row
  when (old.status <> 'paid' and new.status = 'paid')
  execute function app.bill_close_order();

select app.enable_audit('vendor_bills');
