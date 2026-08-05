-- =============================================================================
-- M3 / 009 — Purchase orders: the weekly order, in one place both sides can see
-- =============================================================================
-- The order currently exists as a voice call plus a WhatsApp list. Nobody can
-- answer "what did we ask for, from whom, when, and at what price" without
-- scrolling a chat. This migration makes the order a record.
--
-- One design decision carries the whole milestone: a PO line is one of TWO
-- kinds, and they are genuinely different asks.
--
--   * 'restock'    — an existing SKU we have bought before. The vendor already
--                    knows what it looks like; what they need is the code and
--                    the quantity.
--   * 'new_design'  — a series commissioned on the call: "mustard body, maroon
--                    border, six colour combinations". There is no SKU yet,
--                    because the piece does not exist yet. Forcing this into a
--                    product_id would mean inventing a fake SKU at order time
--                    and then reconciling it — which is exactly the mess this
--                    system is meant to remove.
--
-- The SKU for a new design is created when the goods actually arrive and we
-- know what we got. Until then the line carries the brief, and only the brief.
--
-- Vendor visibility starts at 'issued'. A draft PO is Pooja thinking out loud
-- and must never appear in the portal — enforced in the RLS policy, not here.
-- =============================================================================

create type po_status as enum (
  'draft',               -- being assembled by Procurement; invisible to vendor
  'issued',              -- sent; vendor can see it and is expected to respond
  'acknowledged',        -- vendor has confirmed they will make it
  'in_production',       -- vendor is weaving
  'dispatched',          -- handed to a transporter
  'partially_received',  -- some units counted in at the warehouse
  'received',            -- all units accounted for
  'closed',              -- billed and settled
  'cancelled'
);

create type po_line_kind as enum ('restock', 'new_design');

-- -----------------------------------------------------------------------------
-- Document numbering
-- -----------------------------------------------------------------------------
-- Lives in `app`, not `public`: it is infrastructure, has no RLS story, and
-- should not be reachable as a PostgREST resource.
create table app.document_counters (
  scope      text    primary key,
  next_value integer not null default 1
);

-- Returns a human-quotable number such as PO-2608-0007.
--
-- The insert-on-conflict-update form takes a row lock and increments in one
-- statement, so two Procurement Heads issuing a PO in the same second cannot
-- collide. A plain `select max(...) + 1` would.
create or replace function app.next_document_number(p_prefix text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period text := to_char(now(), 'YYMM');
  v_scope  text := p_prefix || '-' || v_period;
  v_n      integer;
begin
  insert into app.document_counters as c (scope, next_value)
  values (v_scope, 1)
  on conflict (scope) do update set next_value = c.next_value + 1
  returning c.next_value into v_n;

  return p_prefix || '-' || v_period || '-' || lpad(v_n::text, 4, '0');
end;
$$;

-- -----------------------------------------------------------------------------
-- purchase_orders
-- -----------------------------------------------------------------------------
create table purchase_orders (
  id                     uuid        primary key default gen_random_uuid(),
  vendor_id              uuid        not null references vendors (id) on delete restrict,
  po_number              text        not null,
  status                 po_status   not null default 'draft',

  -- What the team calls this order on the call: "Week of 11 Aug", "Diwali 1".
  title                  text        check (title is null or length(trim(title)) between 2 and 120),
  -- The date the stock is needed by. Drives the overdue list, which is the
  -- single most-used number on the Procurement dashboard.
  required_by            date,

  -- Vendor-visible instructions. Packing notes, label instructions, anything
  -- said on the call that the weaver needs in writing.
  instructions           text,

  -- --- Lifecycle stamps ----------------------------------------------------
  issued_at              timestamptz,
  issued_by              uuid        references app_users (id),
  acknowledged_at        timestamptz,
  acknowledged_by        uuid        references app_users (id),
  -- The vendor's own commitment, which is frequently not the date we asked for.
  -- Keeping both is what makes a vendor scorecard possible later: we can
  -- distinguish "agreed a later date" from "missed the agreed date".
  promised_date          date,

  -- --- Dispatch (filled in by the vendor from the portal) ------------------
  dispatched_at          timestamptz,
  transporter            text,
  -- Lorry receipt / docket number. The warehouse quotes this when a parcel is
  -- missing, so it must be recorded at dispatch rather than reconstructed later.
  docket_number          text,
  parcel_count           integer     check (parcel_count is null or parcel_count > 0),

  received_at            timestamptz,
  closed_at              timestamptz,
  cancelled_at           timestamptz,
  cancellation_reason    text,

  -- --- Money ---------------------------------------------------------------
  -- Maintained by trigger from the lines. Denormalised because every list view
  -- shows an order value, and re-aggregating lines for each row of a list is
  -- the classic reason a procurement screen takes four seconds to load.
  subtotal_amount        numeric(14, 2) not null default 0,
  tax_amount             numeric(14, 2) not null default 0,
  total_amount           numeric(14, 2) not null default 0,

  created_by             uuid        references app_users (id),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  deleted_at             timestamptz,
  version                integer     not null default 1,

  constraint purchase_orders_issued_stamped
    check (status = 'draft' or status = 'cancelled' or issued_at is not null),
  constraint purchase_orders_cancel_needs_reason
    check (status <> 'cancelled' or cancellation_reason is not null)
);

create unique index purchase_orders_number_uniq on purchase_orders (po_number);
create index purchase_orders_vendor_idx on purchase_orders (vendor_id) where deleted_at is null;
-- The two hot list queries: "open orders" and "what is late".
create index purchase_orders_open_idx
  on purchase_orders (status, required_by)
  where deleted_at is null
    and status not in ('closed', 'cancelled', 'draft');
create index purchase_orders_vendor_open_idx
  on purchase_orders (vendor_id, status) where deleted_at is null;

create trigger purchase_orders_touch
  before update on purchase_orders
  for each row execute function app.touch_row();
create trigger purchase_orders_no_hard_delete
  before delete on purchase_orders
  for each row execute function app.forbid_hard_delete();

comment on table purchase_orders is
  'The weekly order to one vendor. Visible to the vendor only from status = issued onwards.';
comment on column purchase_orders.promised_date is
  'The date the VENDOR committed to, which is often not required_by. Keeping both separates "agreed late" from "delivered late".';

-- -----------------------------------------------------------------------------
-- purchase_order_lines
-- -----------------------------------------------------------------------------
create table purchase_order_lines (
  id                uuid          primary key default gen_random_uuid(),
  purchase_order_id uuid          not null references purchase_orders (id) on delete restrict,
  -- Denormalised from the header so every isolation policy — and the isolation
  -- test suite, which discovers tables by this column — can resolve ownership
  -- without a join. Kept truthful by trigger.
  vendor_id         uuid          not null references vendors (id) on delete restrict,
  line_no           integer       not null check (line_no > 0),

  kind              po_line_kind  not null,

  -- Set for 'restock'. NULL for 'new_design' until the SKU exists, which is
  -- after the goods arrive.
  product_id        uuid          references products (id) on delete restrict,
  -- Optional on a restock line, and the usual case on a new_design line once
  -- the series has been named.
  series_id         uuid          references product_series (id) on delete restrict,

  -- The brief, verbatim from the call. Required on a new_design line: it is the
  -- only description of a piece that does not exist yet.
  description       text,
  -- The colour combinations asked for. An array rather than free text because
  -- "six colours" needs to be countable at receipt.
  colours           text[]        not null default '{}',

  quantity          integer       not null check (quantity > 0),
  unit_price        numeric(12, 2) not null check (unit_price >= 0),
  gst_rate          numeric(5, 2) not null default 5 check (gst_rate >= 0 and gst_rate <= 28),

  -- Maintained by the goods-receipt trigger in migration 010.
  quantity_received integer       not null default 0 check (quantity_received >= 0),

  -- Stored generated columns: the arithmetic must be identical everywhere it is
  -- shown, and a rounding difference between the portal and the PO PDF is the
  -- kind of thing a vendor notices and stops trusting the system over.
  line_subtotal     numeric(14, 2) generated always as (quantity * unit_price) stored,
  line_tax          numeric(14, 2) generated always as
                      (round(quantity * unit_price * gst_rate / 100, 2)) stored,
  line_total        numeric(14, 2) generated always as
                      (quantity * unit_price + round(quantity * unit_price * gst_rate / 100, 2)) stored,

  created_at        timestamptz   not null default now(),
  updated_at        timestamptz   not null default now(),
  deleted_at        timestamptz,
  version           integer       not null default 1,

  constraint po_lines_restock_needs_product
    check (kind <> 'restock' or product_id is not null),
  -- A new design has no SKU by definition; allowing one would let a line be
  -- both, and the receipt flow would not know whether to create a product.
  constraint po_lines_new_design_has_no_product
    check (kind <> 'new_design' or product_id is null),
  constraint po_lines_new_design_needs_brief
    check (kind <> 'new_design' or length(trim(coalesce(description, ''))) >= 3)
);

create unique index po_lines_no_uniq
  on purchase_order_lines (purchase_order_id, line_no) where deleted_at is null;
create index po_lines_po_idx      on purchase_order_lines (purchase_order_id) where deleted_at is null;
create index po_lines_vendor_idx  on purchase_order_lines (vendor_id) where deleted_at is null;
create index po_lines_product_idx on purchase_order_lines (product_id) where deleted_at is null;

create trigger po_lines_touch
  before update on purchase_order_lines
  for each row execute function app.touch_row();
create trigger po_lines_no_hard_delete
  before delete on purchase_order_lines
  for each row execute function app.forbid_hard_delete();

comment on table purchase_order_lines is
  'A line is either a restock of a known SKU or a new-design brief with no SKU yet. The SKU for a new design is created at goods receipt.';

-- Now that lines exist, record where a commissioned series came from. This is
-- how "which order did this design start on?" stays answerable a year later.
alter table product_series
  add column origin_po_line_id uuid references purchase_order_lines (id) on delete restrict;

create index product_series_origin_idx
  on product_series (origin_po_line_id) where origin_po_line_id is not null;

-- -----------------------------------------------------------------------------
-- purchase_order_messages — the thread that replaces the WhatsApp thread
-- -----------------------------------------------------------------------------
-- Every question about an order currently arrives out of band and is lost.
-- Attaching the conversation to the order means the answer to "why is this
-- late?" lives next to the order rather than in someone's phone.
--
-- `is_internal` lets Procurement note something the vendor must not read
-- ("check quality, last lot was poor"). Postgres has no column-level RLS, so
-- the flag governs the whole row and the policy filters on it.
create table purchase_order_messages (
  id                uuid        primary key default gen_random_uuid(),
  purchase_order_id uuid        not null references purchase_orders (id) on delete restrict,
  vendor_id         uuid        not null references vendors (id) on delete restrict,
  author_id         uuid        references app_users (id),
  body              text        not null check (length(trim(body)) between 1 and 4000),
  is_internal       boolean     not null default false,
  created_at        timestamptz not null default now()
);

create index po_messages_po_idx     on purchase_order_messages (purchase_order_id, created_at);
create index po_messages_vendor_idx on purchase_order_messages (vendor_id);

comment on table purchase_order_messages is
  'Order-scoped conversation. is_internal rows are never visible to the vendor — the flag governs the row because Postgres has no column-level RLS.';

-- -----------------------------------------------------------------------------
-- Header consistency
-- -----------------------------------------------------------------------------
-- Assigns the PO number and pins vendor_id on lines. Both are things a caller
-- can get wrong, and a line whose vendor_id disagreed with its header would be
-- visible to the wrong vendor — the one failure this system must not have.
create or replace function app.po_assign_number()
returns trigger
language plpgsql
as $$
begin
  if new.po_number is null or new.po_number = '' then
    new.po_number := app.next_document_number('PO');
  end if;
  return new;
end;
$$;

create trigger purchase_orders_number_trg
  before insert on purchase_orders
  for each row execute function app.po_assign_number();

create or replace function app.po_line_inherit_vendor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vendor uuid;
  v_status public.po_status;
begin
  select po.vendor_id, po.status into v_vendor, v_status
    from public.purchase_orders po
   where po.id = new.purchase_order_id;

  if v_vendor is null then
    raise exception 'Purchase order % does not exist.', new.purchase_order_id
      using errcode = 'foreign_key_violation';
  end if;

  -- Never trust a caller-supplied vendor_id on a child row.
  new.vendor_id := v_vendor;

  if new.line_no is null then
    select coalesce(max(l.line_no), 0) + 1 into new.line_no
      from public.purchase_order_lines l
     where l.purchase_order_id = new.purchase_order_id;
  end if;

  -- A product line must belong to the vendor the order is going to. Otherwise a
  -- PO could quote another vendor's SKU — and their price — back at them.
  if new.product_id is not null then
    if not exists (
      select 1 from public.products p
       where p.id = new.product_id and p.vendor_id = v_vendor
    ) then
      raise exception 'Product % does not belong to the vendor on this purchase order.', new.product_id
        using errcode = 'foreign_key_violation';
    end if;
  end if;

  if new.series_id is not null then
    if not exists (
      select 1 from public.product_series s
       where s.id = new.series_id and s.vendor_id = v_vendor
    ) then
      raise exception 'Series % does not belong to the vendor on this purchase order.', new.series_id
        using errcode = 'foreign_key_violation';
    end if;
  end if;

  -- Lines are the offer. Changing them after the vendor has agreed a price
  -- would rewrite a commitment; issue an amendment PO instead.
  if tg_op = 'INSERT' and v_status not in ('draft', 'issued') then
    raise exception
      'Purchase order is % — lines can only be added while it is draft or issued.', v_status
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger po_lines_inherit_vendor_trg
  before insert or update on purchase_order_lines
  for each row execute function app.po_line_inherit_vendor();

-- Keeps the header totals equal to the sum of live lines. Runs as definer so a
-- vendor acknowledging an order does not need UPDATE rights on the header's
-- money columns to keep them consistent.
create or replace function app.po_recalculate_totals()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po uuid := coalesce(new.purchase_order_id, old.purchase_order_id);
begin
  update public.purchase_orders po
     set subtotal_amount = t.subtotal,
         tax_amount      = t.tax,
         total_amount    = t.total
    from (
      select coalesce(sum(l.line_subtotal), 0) as subtotal,
             coalesce(sum(l.line_tax), 0)      as tax,
             coalesce(sum(l.line_total), 0)    as total
        from public.purchase_order_lines l
       where l.purchase_order_id = v_po
         and l.deleted_at is null
    ) t
   where po.id = v_po
     and (po.subtotal_amount, po.tax_amount, po.total_amount)
         is distinct from (t.subtotal, t.tax, t.total);

  return null;
end;
$$;

create trigger po_lines_totals_trg
  after insert or update or delete on purchase_order_lines
  for each row execute function app.po_recalculate_totals();

-- -----------------------------------------------------------------------------
-- The status machine
-- -----------------------------------------------------------------------------
-- Enforced in the database rather than the application because there are three
-- different clients (Procurement screens, the vendor portal, the warehouse
-- screen) and they must not each carry their own idea of what is legal.
--
-- RLS decides WHICH orders you can touch. This trigger decides WHAT you may do
-- to them. Keeping the two separate is what stops the policies turning into an
-- unreadable knot of status predicates.
create or replace function app.po_guard_transition()
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

  -- Legal transitions, regardless of who is asking.
  --
  -- Note that receipt is reachable from every live state, not only from
  -- 'dispatched'. Vendors forget to mark dispatch in the portal, and a parcel
  -- physically sitting on the warehouse floor is not made less real by that.
  -- Blocking the count until someone tidies up the status would push the
  -- warehouse straight back to counting on paper.
  if v_change not in (
    'draft->issued',            'draft->cancelled',
    'issued->acknowledged',     'issued->cancelled',
    'acknowledged->in_production', 'acknowledged->dispatched', 'acknowledged->cancelled',
    'in_production->dispatched', 'in_production->cancelled',
    'issued->partially_received',        'issued->received',
    'acknowledged->partially_received',  'acknowledged->received',
    'in_production->partially_received', 'in_production->received',
    'dispatched->partially_received',    'dispatched->received',
    'partially_received->received', 'partially_received->closed',
    'received->closed'
  ) then
    raise exception 'A purchase order cannot go from % to %.', old.status, new.status
      using errcode = 'check_violation';
  end if;

  -- Who may perform it. A NULL role means service_role, a migration or the
  -- outbox consumer — trusted paths that have already been authorised elsewhere.
  if v_role = 'vendor' then
    if v_change not in (
      'issued->acknowledged',
      'acknowledged->in_production',
      'acknowledged->dispatched',
      'in_production->dispatched'
    ) then
      raise exception 'A vendor cannot move a purchase order from % to %.', old.status, new.status
        using errcode = 'insufficient_privilege';
    end if;
  elsif v_role = 'warehouse_manager' then
    -- Receiving is recorded by posting a goods receipt, which drives the
    -- transitions below from migration 010. Nothing else is the warehouse's to
    -- change: they cannot issue an order, cancel one, or close it for payment.
    if new.status not in ('partially_received', 'received') then
      raise exception 'The warehouse can only record receipt, not move % to %.', old.status, new.status
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  -- Stamps. Set here so they are correct no matter which client wrote the row.
  case new.status
    when 'issued' then
      new.issued_at       := coalesce(new.issued_at, now());
      new.issued_by       := coalesce(new.issued_by, v_actor);
    when 'acknowledged' then
      new.acknowledged_at := coalesce(new.acknowledged_at, now());
      new.acknowledged_by := coalesce(new.acknowledged_by, v_actor);
    when 'dispatched' then
      new.dispatched_at   := coalesce(new.dispatched_at, now());
    when 'received' then
      new.received_at     := coalesce(new.received_at, now());
    when 'closed' then
      new.closed_at       := coalesce(new.closed_at, now());
    when 'cancelled' then
      new.cancelled_at    := coalesce(new.cancelled_at, now());
    else
      null;
  end case;

  return new;
end;
$$;

create trigger purchase_orders_guard_transition_trg
  before update of status on purchase_orders
  for each row execute function app.po_guard_transition();

-- An issued order must have something on it. Catching an empty PO at issue is
-- the difference between a vendor asking "what is this?" and never seeing it.
create or replace function app.po_require_lines_on_issue()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'issued' and old.status = 'draft' then
    if not exists (
      select 1 from public.purchase_order_lines l
       where l.purchase_order_id = new.id and l.deleted_at is null
    ) then
      raise exception 'Purchase order % has no lines and cannot be issued.', new.po_number
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

create trigger purchase_orders_require_lines_trg
  before update of status on purchase_orders
  for each row execute function app.po_require_lines_on_issue();

-- -----------------------------------------------------------------------------
-- Notifications and catalogue history
-- -----------------------------------------------------------------------------
-- Every one of these is written in the same transaction as the state change, so
-- a vendor is never notified about an order that was rolled back, and never
-- misses one that committed.
create or replace function app.po_emit_status_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_topic text;
begin
  v_topic := case new.status
    when 'issued'       then 'purchase_order.issued'
    when 'acknowledged' then 'purchase_order.acknowledged'
    when 'dispatched'   then 'purchase_order.dispatched'
    when 'received'     then 'purchase_order.received'
    when 'cancelled'    then 'purchase_order.cancelled'
    else null
  end;

  if v_topic is null then
    return null;
  end if;

  perform app.emit_event(
    v_topic,
    jsonb_build_object(
      'purchase_order_id', new.id,
      'po_number',         new.po_number,
      'vendor_id',         new.vendor_id,
      'status',            new.status,
      'total_amount',      new.total_amount,
      'required_by',       new.required_by,
      'actor_id',          auth.uid()
    ),
    new.vendor_id, 'purchase_order', new.id,
    null,
    -- One notification per order per state, however many times the row is
    -- touched. Without this a retry or a double-click sends the vendor two SMS.
    v_topic || ':' || new.id::text
  );

  -- Ask the vendor again if an issued order is still unacknowledged in 48
  -- hours. A future available_at is all a deferred reminder needs — no
  -- scheduler, and it is cancelled implicitly because the consumer re-checks
  -- status before sending.
  if new.status = 'issued' then
    perform app.emit_event(
      'purchase_order.acknowledgement_overdue',
      jsonb_build_object('purchase_order_id', new.id, 'po_number', new.po_number),
      new.vendor_id, 'purchase_order', new.id,
      now() + interval '48 hours',
      'purchase_order.ack_chase:' || new.id::text
    );
  end if;

  return null;
end;
$$;

create trigger purchase_orders_emit_event_trg
  after update of status on purchase_orders
  for each row
  when (old.status is distinct from new.status)
  execute function app.po_emit_status_event();

-- Stamps ordering history onto the catalogue when an order is issued. This is
-- what lets the vendor's SKU list say "you last sent us this in March" and what
-- restock suggestions will read later.
create or replace function app.po_stamp_products_on_issue()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.products p
     set first_ordered_at  = coalesce(p.first_ordered_at, now()),
         last_ordered_at   = now(),
         units_ordered_total = p.units_ordered_total + l.quantity
    from public.purchase_order_lines l
   where l.purchase_order_id = new.id
     and l.deleted_at is null
     and l.product_id = p.id;

  return null;
end;
$$;

create trigger purchase_orders_stamp_products_trg
  after update of status on purchase_orders
  for each row
  when (old.status = 'draft' and new.status = 'issued')
  execute function app.po_stamp_products_on_issue();

create or replace function app.po_message_emit_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Internal notes are for us. Notifying the vendor about a note they cannot
  -- read would be worse than not notifying them at all.
  if new.is_internal then
    return null;
  end if;

  perform app.emit_event(
    'purchase_order.message_posted',
    jsonb_build_object(
      'purchase_order_id', new.purchase_order_id,
      'message_id',        new.id,
      'author_id',         new.author_id,
      'vendor_id',         new.vendor_id
    ),
    new.vendor_id, 'purchase_order', new.purchase_order_id,
    null,
    'purchase_order.message:' || new.id::text
  );
  return null;
end;
$$;

create trigger po_messages_emit_event_trg
  after insert on purchase_order_messages
  for each row execute function app.po_message_emit_event();

select app.enable_audit('purchase_orders');
select app.enable_audit('purchase_order_lines');
