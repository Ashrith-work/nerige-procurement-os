-- =============================================================================
-- 036 — Inwarding: what actually arrived. Lookup: what support reads on the phone.
-- =============================================================================
-- Two modules in one file because they share one question — who, beyond
-- procurement, may read an order — and answering it twice in two files is how
-- the answers drift.
--
-- INWARDING
--
-- Until now the schema had no goods-inward event at all. An order went
-- issued → accepted → dispatched and then nothing: `received` existed in the
-- enum, every guard refused it, and `order_lines.quantity_received` was a
-- column waiting for a module (migration 003 says so). PRODUCT.md states the
-- cost: sell-through reconstructs "units received" from sold-plus-remaining,
-- which is biased whenever stock lands mid-period, because nothing recorded
-- that it did.
--
-- TWO TABLES, NOT ONE. A parcel is an event: one person opened it, at one time,
-- with one note ("box wet on arrival"). What was in it is per line. Partial
-- receipts are real — a parcel short by two, the rest a week later — so an order
-- has several parcels and each parcel touches several lines. One table would
-- repeat who/when/note on every line and could not answer "what came in that
-- box" for a printed sheet; two tables answer both without a GROUP BY guess.
--
--   order_receipts        one row per parcel opened at the bench
--   order_line_receipts   what that parcel held for one line: received,
--                         rejected (and why), a note
--
-- APPEND-ONLY. No INSERT, UPDATE or DELETE is granted to `authenticated` on
-- either table. The only writer is `public.record_order_receipt()`, which checks
-- the capability, locks the order, validates every line and moves the order to
-- `received` in the same transaction. A count at the receiving bench is a fact
-- about a moment; a correction is a new parcel row, not an edit of the old one.
--
-- WHEN AN ORDER IS RECEIVED. Every line is accounted for when, summed across
-- parcels, received + rejected >= ordered. A rejected piece did arrive — it is
-- accounted for; whether the weaver owes a replacement is a new order, not an
-- open one. The bench can also close an order SHORT ("the rest is not coming"),
-- which requires a note, because an order closed with pieces missing and no
-- reason is a disappearance. `src/lib/inwarding/rules.ts` is the application
-- twin of these rules and is unit-tested against the same cases.
--
-- ONLY A DISPATCHED ORDER CAN BE RECEIVED. An issued or accepted order has no
-- docket and no dispatch date; receiving against it would let the warehouse
-- silently overwrite the weaver's own record of what she sent. A parcel that
-- arrives before she marks it dispatched waits on the shelf while procurement
-- rings her — the list shows those as "late, not dispatched" so they are seen.
--
-- THE ONE CHANGE TO AN EXISTING GUARD
--
-- `app.orders_internal_write_guard()` (migration 009) refuses every status move
-- by procurement except cancel. An admin or procurement_head receiving a parcel
-- runs the RPC under their own JWT, so that guard fires on the RPC's UPDATE and
-- would refuse it. It gains exactly one permitted move:
--
--     dispatched → received, only when
--       * the caller can receive goods, AND
--       * `received_at` is set in the same write, AND
--       * the order is accounted for in the receipt tables.
--
-- Everything else in the guard is reproduced verbatim. The weaver's guard
-- (migration 006) is not touched: it still refuses a vendor any move to
-- `received`, and the isolation suite still asserts that.
--
-- One NEW trigger sits beside the two guards, for the two new columns. Every
-- session holds a table-level UPDATE on `orders` (migration 006), so column
-- grants do not protect `received_at` / `received_by` — a weaver could otherwise
-- stamp her own order received, and neither existing guard looks at columns it
-- has never heard of. `app.orders_receiving_guard()` refuses any change to
-- them from a signed-in session except as part of the one permitted move, by
-- someone who can receive goods, naming themself. So by hand, procurement can
-- do at most exactly what the RPC does, and only once the counts say so.
--
-- LOOKUP
--
-- customer_support had no read on products, orders or sales — only
-- `app.is_internal()` did. `is_internal()` is not widened (migration 021 says
-- why). Nor does support get SELECT policies on `products` or `orders`: RLS is
-- row-level, and a policy that admits a products row admits its `cost` column
-- with it. Postgres cannot hide one column from one application role when every
-- role connects as `authenticated`. So the lookup reads through two SECURITY
-- DEFINER functions that name their columns — `cost` is not among them, nor
-- WhatsApp numbers, PO links or anything else from the order's back office —
-- gated on a new capability, `app.can_lookup()`. Strictly read-only: both are
-- STABLE and neither writes.
--
-- The warehouse manager DOES get row policies on orders, order lines, their
-- reference photos and vendors, through `app.can_receive_goods()`: the receiving
-- bench renders the order itself, and none of those tables carries a cost.
-- `products` is not granted to the warehouse — the order lines carry the
-- photograph and title as snapshots, which is what was ordered anyway.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Capabilities
-- -----------------------------------------------------------------------------
-- Same four properties as migration 021: SECURITY DEFINER, pinned search_path,
-- STABLE, in `app` so PostgREST cannot reach them.

-- Who opens a weaver's parcel and says what was in it. Procurement is included
-- because a small team receives whatever lands when the warehouse manager is
-- out; the developer is not, because the developer writes nothing.
create or replace function app.can_receive_goods()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    app.current_role() in ('admin', 'procurement_head', 'warehouse_manager'),
    false
  );
$$;

comment on function app.can_receive_goods() is
  'Who records goods received from a weaver: admin, procurement_head, warehouse_manager. Mirrors requireReceiving().';

-- Who may use the lookup. Every staff role plus the developer (who reads
-- everything by migration 033, and must be able to see support's screen when
-- viewing as support). Never a vendor: the lookup searches every weaver.
create or replace function app.can_lookup()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(app.is_staff() or app.is_developer(), false);
$$;

comment on function app.can_lookup() is
  'Read-only product lookup: the four staff roles and the developer. Never a vendor. Gates lookup_products/lookup_product only.';

grant execute on function app.can_receive_goods(), app.can_lookup() to authenticated;

-- -----------------------------------------------------------------------------
-- Who received the order, on the order
-- -----------------------------------------------------------------------------
-- Denormalised from the final parcel so the order list can sort "received this
-- week" without aggregating receipts. Written by the RPC; guarded against every
-- other writer by app.orders_receiving_guard() below.
alter table orders
  add column received_at timestamptz,
  add column received_by uuid references app_users (id);

comment on column orders.received_at is
  'When the last line was accounted for and the order became received. Written only by record_order_receipt().';

create index orders_received_at_idx on orders (received_at desc) where status = 'received';

-- -----------------------------------------------------------------------------
-- Why a piece was turned away
-- -----------------------------------------------------------------------------
create type receipt_reject_reason as enum (
  'damaged',        -- torn, stained, wet in transit
  'wrong_design',   -- not the saree in the photograph
  'weaving_error',  -- the saree, woven badly: missed motif, loose border, short length
  'other'
);

-- -----------------------------------------------------------------------------
-- order_receipts — one parcel, opened at the bench
-- -----------------------------------------------------------------------------
create table order_receipts (
  id               uuid        primary key default gen_random_uuid(),
  order_id         uuid        not null references orders (id) on delete cascade,
  received_at      timestamptz not null default now(),
  received_by      uuid        references app_users (id),

  -- A snapshot of the name. The warehouse manager cannot read other people's
  -- app_users rows (and should not be granted them to render one line of
  -- history), and "who opened this box" is a question about then, not about
  -- whatever that login is called now.
  received_by_name text,

  note             text        check (note is null or length(note) <= 2000),

  -- "Nothing more is coming." Marks the order accounted for even with pieces
  -- outstanding. The RPC refuses it without a note.
  closes_order     boolean     not null default false,

  created_at       timestamptz not null default now()
);

create index order_receipts_order_idx on order_receipts (order_id, received_at desc);

comment on table order_receipts is
  'One parcel from a weaver, opened at the receiving bench. Append-only; written only by record_order_receipt().';
comment on column order_receipts.closes_order is
  'The bench declared nothing more is coming: the order is received with whatever shortfall remains.';

-- -----------------------------------------------------------------------------
-- order_line_receipts — what that parcel held for one line
-- -----------------------------------------------------------------------------
-- For a restock line the pieces carry the SKU. For a new-design line they carry
-- nothing — the weaver invented them — so the count is all there is, and those
-- pieces go on to intake to be given codes.
create table order_line_receipts (
  id             uuid      primary key default gen_random_uuid(),
  receipt_id     uuid      not null references order_receipts (id) on delete cascade,
  order_line_id  uuid      not null references order_lines (id) on delete cascade,

  qty_received   integer   not null default 0 check (qty_received between 0 and 100000),
  qty_rejected   integer   not null default 0 check (qty_rejected between 0 and 100000),
  reject_reason  receipt_reject_reason,
  note           text      check (note is null or length(note) <= 1000),

  -- One entry per line per parcel. Two entries for the same line in one box is
  -- a double count waiting to happen.
  unique (receipt_id, order_line_id),

  -- A line with nothing on it says nothing; it is not stored.
  constraint order_line_receipts_something
    check (qty_received + qty_rejected > 0),

  -- A rejection without a reason cannot be taken up with the weaver, and a
  -- reason with nothing rejected is noise.
  constraint order_line_receipts_reason_iff_rejected
    check ((qty_rejected > 0) = (reject_reason is not null))
);

create index order_line_receipts_line_idx on order_line_receipts (order_line_id);

comment on table order_line_receipts is
  'Pieces received and rejected for one order line in one parcel. Summed across parcels to decide whether the line is accounted for.';

-- The line must belong to the parcel's order. Checked against the true rows
-- (SECURITY DEFINER), as migration 003's integrity triggers are, and on every
-- write path — including an owner script that never went through the RPC.
create or replace function app.order_line_receipts_same_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
      from public.order_receipts r
      join public.order_lines ol on ol.order_id = r.order_id
     where r.id = new.receipt_id
       and ol.id = new.order_line_id
  ) then
    raise exception
      'Line % is not on the order this parcel was received against.', new.order_line_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger order_line_receipts_same_order_trg
  before insert or update on order_line_receipts
  for each row execute function app.order_line_receipts_same_order();

-- -----------------------------------------------------------------------------
-- Row Level Security on the two new tables
-- -----------------------------------------------------------------------------
-- Both are vendor-scoped through foreign keys (order_receipts → orders;
-- order_line_receipts → order_receipts and → order_lines), so the isolation
-- suite discovers them and asserts both halves: a weaver sees none of another's
-- parcels, and all of her own. She should see her own — "6 received, 1 rejected,
-- damaged" is the answer to the call she would otherwise make.
alter table order_receipts      enable row level security;
alter table order_line_receipts enable row level security;
alter table order_receipts      force row level security;
alter table order_line_receipts force row level security;

create policy order_receipts_select_receiving on order_receipts
  for select to authenticated
  using ((select app.can_receive_goods()));

create policy order_receipts_select_own on order_receipts
  for select to authenticated
  using (
    exists (
      select 1 from orders o
       where o.id = order_receipts.order_id
         and o.vendor_id = (select app.current_vendor_id())
    )
  );

create policy order_line_receipts_select_receiving on order_line_receipts
  for select to authenticated
  using ((select app.can_receive_goods()));

create policy order_line_receipts_select_own on order_line_receipts
  for select to authenticated
  using (
    exists (
      select 1
        from order_receipts r
        join orders o on o.id = r.order_id
       where r.id = order_line_receipts.receipt_id
         and o.vendor_id = (select app.current_vendor_id())
    )
  );

-- SELECT only. See the header: the RPC is the only writer.
grant select on order_receipts      to authenticated;
grant select on order_line_receipts to authenticated;

select app.grant_developer_read('public.order_receipts');
select app.grant_developer_read('public.order_line_receipts');

-- -----------------------------------------------------------------------------
-- The receiving bench reads the order it is receiving
-- -----------------------------------------------------------------------------
-- Additive permissive SELECT policies. For admin and procurement_head these
-- change nothing (is_internal() already admits them); what they add is the
-- warehouse manager. No write policy is added to any of these tables.
create policy orders_select_receiving on orders
  for select to authenticated
  using ((select app.can_receive_goods()));

create policy order_lines_select_receiving on order_lines
  for select to authenticated
  using ((select app.can_receive_goods()));

create policy order_line_refs_select_receiving on order_line_refs
  for select to authenticated
  using ((select app.can_receive_goods()));

-- Which weaver the parcel is from. The bench also rings her about a short box,
-- so the phone numbers on this row are appropriate here.
create policy vendors_select_receiving on vendors
  for select to authenticated
  using ((select app.can_receive_goods()) and deleted_at is null);

-- -----------------------------------------------------------------------------
-- Is every line accounted for?
-- -----------------------------------------------------------------------------
-- At least one parcel, and then either the bench closed the order short, or no
-- line still has pieces outstanding. SECURITY DEFINER so the answer is about the
-- true rows, never about what the caller's policies happen to reveal.
create or replace function app.order_is_accounted_for(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.order_receipts r where r.order_id = p_order_id)
     and (
       exists (
         select 1 from public.order_receipts r
          where r.order_id = p_order_id and r.closes_order
       )
       or not exists (
         select 1
           from public.order_lines ol
          where ol.order_id = p_order_id
            and ol.quantity > coalesce((
              select sum(lr.qty_received + lr.qty_rejected)
                from public.order_line_receipts lr
               where lr.order_line_id = ol.id
            ), 0)
       )
     );
$$;

comment on function app.order_is_accounted_for(uuid) is
  'True when an order has at least one parcel and either was closed short or every line has received + rejected >= ordered. Twin of orderCompletion() in src/lib/inwarding/rules.ts.';

-- Not granted to authenticated: only the guard and the RPC below call it, both
-- as definer. A client has no reason to probe it.
revoke all on function app.order_is_accounted_for(uuid) from public;

-- -----------------------------------------------------------------------------
-- The internal write guard, with one move added
-- -----------------------------------------------------------------------------
-- Verbatim from migration 009 except the marked clause. See the header.
create or replace function app.orders_internal_write_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Not procurement: a vendor (handled by the other guard), or the owner.
  if not app.is_internal() then
    return new;
  end if;

  -- Cancel is the only write. Everything else on this row belongs to the
  -- weaver: the date she promised, the day she sent it, the docket number.
  if new.status is distinct from old.status
     and not (new.status = 'cancelled' and old.status in ('issued', 'accepted'))
     -- ADDED (inwarding): the goods arrived — stamped with when, and only once
     -- every line is accounted for in the receipt tables. record_order_receipt()
     -- is the path; app.orders_receiving_guard() pins the stamp to the caller.
     and not (
       old.status = 'dispatched'
       and new.status = 'received'
       and new.received_at is not null
       and app.can_receive_goods()
       and app.order_is_accounted_for(new.id)
     ) then
    raise exception
      'Procurement can cancel an issued or accepted order, and nothing else (% to %).',
      old.status, new.status
      using errcode = 'insufficient_privilege';
  end if;

  if new.batch_id     is distinct from old.batch_id
     or new.vendor_id    is distinct from old.vendor_id
     or new.order_number is distinct from old.order_number
     or new.issued_at    is distinct from old.issued_at then
    raise exception
      'The identity of an issued order cannot be changed.'
      using errcode = 'insufficient_privilege';
  end if;

  -- A weaver's own record of what she promised and when she sent it is hers.
  -- Overwriting it from this side is how two people end up arguing from two
  -- differently worded copies of the same order.
  if new.promised_date    is distinct from old.promised_date
     or new.dispatched_at    is distinct from old.dispatched_at
     or new.transport_docket is distinct from old.transport_docket then
    raise exception
      'The promised date, dispatch date and docket are the vendor''s to set.'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- The two new columns, guarded for everyone
-- -----------------------------------------------------------------------------
create or replace function app.orders_receiving_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- No session: the owner running a script or a SECURITY DEFINER sync. Trusted
  -- by construction, as in both other guards.
  if auth.uid() is null then
    return new;
  end if;

  if (new.received_at is distinct from old.received_at
      or new.received_by is distinct from old.received_by)
     and not (
       old.status = 'dispatched'
       and new.status = 'received'
       and old.received_at is null
       and new.received_at is not null
       and new.received_by = auth.uid()
       and app.can_receive_goods()
       and app.order_is_accounted_for(new.id)
     ) then
    raise exception
      'When an order was received, and by whom, is recorded by the receiving bench.'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

create trigger orders_receiving_guard_trg
  before update on orders
  for each row execute function app.orders_receiving_guard();

comment on function app.orders_receiving_guard() is
  'received_at / received_by change only with the dispatched → received move, by someone who can receive goods, once the order is accounted for.';

comment on function app.orders_internal_write_guard() is
  'Procurement may cancel an issued or accepted order; record_order_receipt() may move a dispatched, fully accounted-for order to received. Nothing else.';

-- -----------------------------------------------------------------------------
-- record_order_receipt — one parcel, recorded atomically
-- -----------------------------------------------------------------------------
-- p_lines: [{ "order_line_id": uuid, "received": int, "rejected": int,
--             "reason": "damaged"|"wrong_design"|"weaving_error"|"other",
--             "note": text }]
-- Lines with nothing received and nothing rejected are skipped, so the form can
-- send every line and let the empty ones fall away.
--
-- SECURITY DEFINER because no client holds a write on the receipt tables or on
-- `order_lines`. The capability check on the first line is therefore
-- load-bearing, exactly as in issue_orders. The order's own UPDATE still passes
-- through both order guards and app.orders_receiving_guard() — auth.uid() is the
-- caller's inside a definer function — so this function cannot move an order
-- any way those guards would not let the caller move it.
create or replace function public.record_order_receipt(
  p_order_id    uuid,
  p_lines       jsonb,
  p_note        text    default null,
  p_close_short boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status   public.order_status;
  v_receipt  uuid;
  v_line     jsonb;
  v_line_id  uuid;
  v_received integer;
  v_rejected integer;
  v_reason   public.receipt_reject_reason;
  v_count    integer := 0;
  v_name     text;
  v_note     text := nullif(trim(coalesce(p_note, '')), '');
  v_close    boolean := coalesce(p_close_short, false);
  v_complete boolean;
begin
  if not app.can_receive_goods() then
    raise exception 'Only the warehouse, procurement or the owner can record goods received.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Locked, so two people at the bench entering the same parcel serialise: the
  -- second sees the first's counts and an order that may already be received.
  select o.status into v_status
    from public.orders o
   where o.id = p_order_id
   for update;

  if not found then
    raise exception 'No such order.' using errcode = 'no_data_found';
  end if;

  if v_status <> 'dispatched' then
    raise exception 'Only a dispatched order can be received; this one is %.', v_status
      using errcode = 'check_violation';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'Lines must be a list.' using errcode = 'invalid_parameter_value';
  end if;

  if v_close and v_note is null then
    raise exception 'Say why the order is being closed with pieces missing.'
      using errcode = 'check_violation';
  end if;

  select u.full_name into v_name from public.app_users u where u.id = auth.uid();

  insert into public.order_receipts (order_id, received_by, received_by_name, note, closes_order)
  values (p_order_id, auth.uid(), v_name, v_note, v_close)
  returning id into v_receipt;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    v_line_id  := nullif(v_line ->> 'order_line_id', '')::uuid;
    v_received := coalesce(nullif(v_line ->> 'received', '')::integer, 0);
    v_rejected := coalesce(nullif(v_line ->> 'rejected', '')::integer, 0);

    if v_received < 0 or v_rejected < 0 then
      raise exception 'Quantities cannot be negative.' using errcode = 'check_violation';
    end if;

    continue when v_received + v_rejected = 0;

    if v_line_id is null or not exists (
      select 1 from public.order_lines ol
       where ol.id = v_line_id and ol.order_id = p_order_id
    ) then
      raise exception 'Line % is not on this order.', coalesce(v_line_id::text, '(missing)')
        using errcode = 'check_violation';
    end if;

    if v_rejected > 0 then
      v_reason := nullif(v_line ->> 'reason', '')::public.receipt_reject_reason;
      if v_reason is null then
        raise exception 'Say why % piece(s) were rejected.', v_rejected
          using errcode = 'check_violation';
      end if;
    else
      v_reason := null;
    end if;

    insert into public.order_line_receipts
      (receipt_id, order_line_id, qty_received, qty_rejected, reject_reason, note)
    values
      (v_receipt, v_line_id, v_received, v_rejected, v_reason,
       nullif(trim(coalesce(v_line ->> 'note', '')), ''));

    v_count := v_count + 1;
  end loop;

  if v_count = 0 and not v_close then
    raise exception 'Nothing was entered: record at least one piece received or rejected.'
      using errcode = 'check_violation';
  end if;

  -- The column migration 003 left waiting. Kept as the running total of GOOD
  -- pieces, so anything already reading it reads the truth.
  update public.order_lines ol
     set quantity_received = (
       select coalesce(sum(lr.qty_received), 0)::integer
         from public.order_line_receipts lr
        where lr.order_line_id = ol.id
     )
   where ol.order_id = p_order_id;

  v_complete := app.order_is_accounted_for(p_order_id);

  if v_complete then
    update public.orders
       set status      = 'received',
           received_at = now(),
           received_by = auth.uid()
     where id = p_order_id;
  end if;

  return jsonb_build_object(
    'receipt_id',     v_receipt,
    'status',         case when v_complete then 'received' else 'dispatched' end,
    'lines_recorded', v_count
  );
end;
$$;

comment on function public.record_order_receipt(uuid, jsonb, text, boolean) is
  'Records one parcel against a dispatched order and moves it to received once every line is accounted for (or it is closed short with a note). The only writer of the receipt tables.';

revoke all on function public.record_order_receipt(uuid, jsonb, text, boolean) from public, anon;
grant execute on function public.record_order_receipt(uuid, jsonb, text, boolean) to authenticated;

-- -----------------------------------------------------------------------------
-- lookup_products — search by SKU fragment, Unique Code or title
-- -----------------------------------------------------------------------------
-- Columns named, never `p.*`: this function runs as owner and bypasses RLS, so
-- the column list IS the access control. No cost.
create or replace function public.lookup_products(p_query text, p_limit integer default 30)
returns table (
  sku                    text,
  title                  text,
  seq                    integer,
  unique_code            bigint,
  vendor_code            text,
  vendor_name            text,
  image_url              text,
  image_urls             jsonb,
  display_image_position integer,
  manual_image_url       text,
  crop_json              jsonb,
  crop_mode              text,
  qty_available          integer,
  stock_synced_at        timestamptz,
  units_90d              integer,
  last_sold_at           date,
  is_active              boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_q    text := trim(coalesce(p_query, ''));
  v_like text;
  v_num  bigint;
begin
  if not app.can_lookup() then
    raise exception 'The lookup is for Nerige staff.' using errcode = 'insufficient_privilege';
  end if;

  -- One character matches half the catalogue and answers nothing. A bare number
  -- is the exception: it is a Unique Code.
  if length(v_q) < 2 and v_q !~ '^[0-9]+$' then
    return;
  end if;

  -- Escape LIKE's own wildcards. A SKU fragment containing `_` must match an
  -- underscore, not any character.
  v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  if v_q ~ '^[0-9]{1,15}$' then
    v_num := v_q::bigint;
  end if;

  return query
    select p.sku, p.title, p.seq, i.unique_code, v.code, v.display_name,
           p.image_url, p.image_urls, p.display_image_position, p.manual_image_url,
           p.crop_json, p.crop_mode, p.qty_available, p.stock_synced_at,
           p.units_90d, p.last_sold_at, p.is_active
      from public.products p
      join public.vendors v on v.id = p.vendor_id
      left join public.product_intakes i on i.sku = p.sku
     where p.sku ilike v_like
        or p.title ilike v_like
        or (v_num is not null and (p.seq = v_num or i.unique_code = v_num))
     order by
       -- The exact thing typed first: a full SKU or a Unique Code read off a label.
       (upper(p.sku) = upper(v_q)) desc,
       (v_num is not null and (p.seq = v_num or i.unique_code = v_num)) desc,
       -- Then what customers are most likely ringing about.
       p.units_90d desc,
       p.seq desc nulls last
     limit least(greatest(coalesce(p_limit, 30), 1), 100);
end;
$$;

comment on function public.lookup_products(text, integer) is
  'Staff product search for /lookup. Returns named, cost-free columns only; gated on app.can_lookup().';

revoke all on function public.lookup_products(text, integer) from public, anon;
grant execute on function public.lookup_products(text, integer) to authenticated;

-- -----------------------------------------------------------------------------
-- lookup_product — one design: stock, sales, what is on its way, intake
-- -----------------------------------------------------------------------------
-- "Is it in stock, when will more come, where is it." Returns null for an
-- unknown SKU so the page can say so.
create or replace function public.lookup_product(p_sku text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_product jsonb;
begin
  if not app.can_lookup() then
    raise exception 'The lookup is for Nerige staff.' using errcode = 'insufficient_privilege';
  end if;

  select jsonb_build_object(
           'sku',                    p.sku,
           'title',                  p.title,
           'seq',                    p.seq,
           'collection',             p.collection,
           'fabric',                 p.fabric,
           'colour_code',            p.colour_code,
           'product_type',           p.product_type,
           -- The selling price is on the website; a customer may ask it.
           'price',                  p.price,
           'is_active',              p.is_active,
           'qty_available',          p.qty_available,
           'stock_synced_at',        p.stock_synced_at,
           'image_url',              p.image_url,
           'image_urls',             p.image_urls,
           'display_image_position', p.display_image_position,
           'manual_image_url',       p.manual_image_url,
           'crop_json',              p.crop_json,
           'crop_mode',              p.crop_mode,
           'units_30d',              p.units_30d,
           'units_90d',              p.units_90d,
           'units_365d',             p.units_365d,
           'last_sold_at',           p.last_sold_at,
           'sales_synced_at',        p.sales_synced_at,
           'vendor_code',            v.code,
           'vendor_name',            v.display_name
         )
    into v_product
    from public.products p
    join public.vendors v on v.id = p.vendor_id
   where p.sku = p_sku;

  if v_product is null then
    return null;
  end if;

  return jsonb_build_object(
    'product', v_product,

    'recent_sales', coalesce((
      select jsonb_agg(jsonb_build_object('date', s.date, 'units', s.units, 'orders', s.orders)
                       order by s.date desc)
        from (
          select d.date, d.units, d.orders
            from public.sku_sales_daily d
           where d.sku = p_sku and d.units > 0
           order by d.date desc
           limit 10
        ) s
    ), '[]'::jsonb),

    -- Restock lines only. A new-design line that used this saree as a reference
    -- asks for something LIKE it, which is not "more of this is coming".
    'open_orders', coalesce((
      select jsonb_agg(jsonb_build_object(
               'order_number',  x.order_number,
               'status',        x.status,
               'issued_at',     x.issued_at,
               'promised_date', x.promised_date,
               'dispatched_at', x.dispatched_at,
               'quantity',      x.quantity,
               'received',      x.received,
               'vendor_name',   x.display_name
             ) order by x.promised_date nulls last, x.issued_at)
        from (
          select o.order_number, o.status, o.issued_at, o.promised_date, o.dispatched_at,
                 v.display_name,
                 sum(ol.quantity)::integer as quantity,
                 coalesce(sum(ol.quantity_received), 0)::integer as received
            from public.orders o
            join public.order_lines ol on ol.order_id = o.id
            join public.vendors v on v.id = o.vendor_id
           where ol.sku = p_sku
             and o.status in ('issued', 'accepted', 'dispatched')
           group by o.id, o.order_number, o.status, o.issued_at, o.promised_date,
                    o.dispatched_at, v.display_name
        ) x
    ), '[]'::jsonb),

    -- The last few parcels that carried it: "some came in on Tuesday".
    'recent_receipts', coalesce((
      select jsonb_agg(jsonb_build_object(
               'received_at',  y.received_at,
               'qty_received', y.qty_received,
               'qty_rejected', y.qty_rejected,
               'order_number', y.order_number
             ) order by y.received_at desc)
        from (
          select r.received_at, lr.qty_received, lr.qty_rejected, o.order_number
            from public.order_line_receipts lr
            join public.order_receipts r on r.id = lr.receipt_id
            join public.order_lines ol on ol.id = lr.order_line_id
            join public.orders o on o.id = r.order_id
           where ol.sku = p_sku
           order by r.received_at desc
           limit 5
        ) y
    ), '[]'::jsonb),

    -- Status only. The intake row carries cost_price and draft copy; neither is
    -- support's to read.
    'intake', (
      select jsonb_build_object(
               'unique_code',    i.unique_code,
               'status',         i.status,
               'img_status',     i.img_status,
               'publish_status', i.publish_status,
               'created_at',     i.created_at
             )
        from public.product_intakes i
       where i.sku = p_sku
    )
  );
end;
$$;

comment on function public.lookup_product(text) is
  'One design for /lookup/[sku]: stock with sync age, recent sales, open restock orders and promised dates, recent receipts, intake status. No cost; gated on app.can_lookup().';

revoke all on function public.lookup_product(text) from public, anon;
grant execute on function public.lookup_product(text) to authenticated;
