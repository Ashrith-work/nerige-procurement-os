-- =============================================================================
-- 039 — The warehouse day sheet
-- =============================================================================
-- Praveen keeps a page in a notebook each day: how many sarees went up to the
-- customer experience centre, how many came back, which ones did not, which of
-- those were sold offline, and — for whatever is still missing — a reason and a
-- name. Under it, the orders of the day, and under that, who worked on what.
--
-- The notebook page is the specification (IMG20260918124032) and this schema
-- follows it exactly, with one difference that is the whole reason for building
-- it here rather than leaving it in a spreadsheet:
--
--   THE ORDERS HALF IS NOT TYPED. Every number under "orders" already exists in
--   `dispatch.orders`, synced from Shopify every fifteen minutes for the board
--   the same warehouse works from. Asking a person to count what the database
--   already knows is how a daily sheet starts being filled in at 6pm from
--   memory. So the orders section is READ, and only what no system knows —
--   which saree physically left the building, and why it did not come back — is
--   typed.
--
-- WHY THE ORDER FIGURES COME THROUGH A FUNCTION. `dispatch` is deliberately not
-- on PostgREST's exposed schema list (see nerige-dispatch/src/lib/db.ts: those
-- tables carry the name, phone and address of every customer of the last
-- month). A SECURITY DEFINER function in `public` returns counts and nothing
-- else — no customer, no address, no order number — so the day sheet can read
-- the shape of the day without the schema becoming reachable over the wire.
-- =============================================================================

create type day_movement as enum ('cec', 'ae_change', 'video_call');

comment on type day_movement is
  'Where a saree went. `ae_change` is the manager''s own word, carried through from the notebook page; rename it here and in src/lib/day-sheet.ts together if it should read differently.';

-- -----------------------------------------------------------------------------
-- warehouse_days — one row per day: the totals, and the note
-- -----------------------------------------------------------------------------
-- Only the counts a person observes. Nothing about orders: see the header.
create table warehouse_days (
  work_date       date        primary key,

  cec_out         integer     not null default 0 check (cec_out >= 0),
  cec_back        integer     not null default 0 check (cec_back >= 0),
  ae_out          integer     not null default 0 check (ae_out >= 0),
  ae_back         integer     not null default 0 check (ae_back >= 0),
  video_out       integer     not null default 0 check (video_out >= 0),
  video_back      integer     not null default 0 check (video_back >= 0),
  -- The one order figure a person genuinely knows and no system records: an
  -- order that began as a video call rather than on the website.
  video_orders    integer     not null default 0 check (video_orders >= 0),

  note            text        check (note is null or length(note) <= 1000),

  recorded_by     uuid        references app_users (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- Required by app.touch_row(), which every table using that trigger carries:
  -- the function assigns new.version, so a table without the column raises
  -- `record "new" has no field "version"` on every UPDATE.
  version         integer     not null default 1
);

create trigger warehouse_days_touch
  before update on warehouse_days
  for each row execute function app.touch_row();

comment on table warehouse_days is
  'The day''s observed totals. The orders half of the day sheet is read from dispatch.orders, never typed.';

-- -----------------------------------------------------------------------------
-- warehouse_movements — one row per saree that left the building
-- -----------------------------------------------------------------------------
-- The heart of the page. A saree is written down when it goes up; it is ticked
-- when it comes back, or marked sold; and anything still unaccounted for at the
-- end of the day needs a reason and a name against it.
--
-- `sku` is text and is NOT a foreign key to `products`. Two reasons, both from
-- the floor: the CEC handles sarees that are not in the catalogue yet (an
-- intake still being photographed), and a manager writing at speed will
-- sometimes record a code that needs correcting later. A refused row is a row
-- that does not get written down at all, which is worse than an unmatched one —
-- so the screen tells him when a code is not in the catalogue and stores it
-- either way.
create table warehouse_movements (
  id            uuid          primary key default gen_random_uuid(),
  work_date     date          not null,
  kind          day_movement  not null,

  sku           text          not null check (length(trim(sku)) between 1 and 120),

  went_out      boolean       not null default true,
  came_back     boolean       not null default false,
  sold_offline  boolean       not null default false,

  bill_no       text          check (bill_no is null or length(trim(bill_no)) <= 60),
  reason        text          check (reason is null or length(trim(reason)) <= 400),
  -- Who dealt with it. Free text rather than a staff id: the floor staff have
  -- no logins (migration 034), so this is a name written by the manager.
  who           text          check (who is null or length(trim(who)) <= 80),

  recorded_by   uuid          references app_users (id),
  created_at    timestamptz   not null default now(),
  updated_at    timestamptz   not null default now(),
  -- See warehouse_days above: app.touch_row() assigns it on every UPDATE.
  version       integer       not null default 1,

  -- The same saree twice in one day under one movement is a duplicate line, not
  -- a second journey. Recorded once; edited after that.
  unique (work_date, kind, sku)
);

create index warehouse_movements_day_idx on warehouse_movements (work_date, kind);
-- "Where has this saree been" — asked when one goes missing for a week.
create index warehouse_movements_sku_idx on warehouse_movements (sku, work_date desc);

create trigger warehouse_movements_touch
  before update on warehouse_movements
  for each row execute function app.touch_row();

comment on table warehouse_movements is
  'One saree, one day, one movement. Unmatched SKUs are permitted on purpose: a refused row is a row nobody writes down.';
comment on column warehouse_movements.sku is
  'Deliberately not a foreign key — the CEC handles sarees the catalogue does not have yet. The screen flags an unknown code rather than refusing it.';

-- -----------------------------------------------------------------------------
-- Who may do what
-- -----------------------------------------------------------------------------
-- The same hands as the staff sheet: the warehouse manager keeps it, the owner
-- may correct it, and nobody else writes. Procurement and support can read the
-- day, because "did that saree come back" is asked on the phone.
create or replace function app.can_record_day()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(app.current_role() in ('admin', 'warehouse_manager'), false);
$$;

grant execute on function app.can_record_day() to authenticated;

alter table warehouse_days       enable row level security;
alter table warehouse_movements  enable row level security;
alter table warehouse_days       force row level security;
alter table warehouse_movements  force row level security;

create policy warehouse_days_read on warehouse_days
  for select to authenticated using ((select app.is_staff()));
create policy warehouse_days_write on warehouse_days
  for all to authenticated
  using ((select app.can_record_day())) with check ((select app.can_record_day()));

create policy warehouse_movements_read on warehouse_movements
  for select to authenticated using ((select app.is_staff()));
create policy warehouse_movements_write on warehouse_movements
  for all to authenticated
  using ((select app.can_record_day())) with check ((select app.can_record_day()));

select app.grant_developer_read('public.warehouse_days');
select app.grant_developer_read('public.warehouse_movements');

grant select, insert, update, delete on warehouse_days      to authenticated;
grant select, insert, update, delete on warehouse_movements to authenticated;

-- -----------------------------------------------------------------------------
-- The orders half, read rather than typed
-- -----------------------------------------------------------------------------
-- Counts only. The function never returns an order number, a customer or an
-- address, so exposing it to every staff role exposes the shape of a day and
-- nothing that identifies anybody.
--
-- `dispatch` may not exist on a database where only this application has been
-- installed — a developer's throwaway Postgres, or the test harness. The
-- function answers zeros there instead of failing, so the rest of the day sheet
-- still works and the screen can say the board is not connected.
create or replace function public.warehouse_day_orders(p_date date)
returns table (
  orders_received     integer,
  domestic            integer,
  international       integer,
  saree_only          integer,
  service_orders      integer,
  stitched_orders     integer,
  offline_orders      integer,
  can_ship_today      integer,
  dispatched          integer,
  still_to_go         integer,
  open_till_date      integer,
  oldest_open         date,
  board_connected     boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_has_dispatch boolean;
begin
  -- `app.is_staff()` deliberately excludes the developer (migration 033 keeps
  -- that role out of every capability and gives it a blanket SELECT instead).
  -- Admitting it here by name keeps view-as honest: a developer checking this
  -- screen must see the orders half as the manager sees it, and the function
  -- returns counts only, so there is nothing here to protect from a login that
  -- can already read every table.
  if not ((select app.is_staff()) or (select app.is_developer())) then
    raise exception 'The day sheet is for Nerige staff.' using errcode = 'insufficient_privilege';
  end if;

  select exists (
    select 1 from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'dispatch' and c.relname = 'orders'
  ) into v_has_dispatch;

  if not v_has_dispatch then
    return query select 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, null::date, false;
    return;
  end if;

  return query execute $q$
    with placed as (
      select o.*
        from dispatch.orders o
       where o.placed_at::date = $1
         and o.cancelled_at is null
    ),
    shipped as (
      select s.shopify_order_id
        from dispatch.order_state s
       where s.shipped_at::date = $1
    ),
    open_orders as (
      select o.placed_at::date as placed_on
        from dispatch.orders o
        left join dispatch.order_state s on s.shopify_order_id = o.shopify_order_id
       where o.placed_at::date <= $1
         and o.cancelled_at is null
         and o.stream <> 'digital'
         and coalesce(s.status::text, 'pending') not in ('shipped', 'cancelled')
    ),
    -- Of the orders placed on this day, the ones that had not gone out. Narrower
    -- than open_orders, which is every day's leftovers up to and including this
    -- one — the two answer different questions and must not share a count.
    placed_still_open as (
      select 1
        from placed o
        left join dispatch.order_state s on s.shopify_order_id = o.shopify_order_id
       where o.stream <> 'digital'
         and coalesce(s.status::text, 'pending') not in ('shipped', 'cancelled')
    )
    select
      (select count(*) from placed)::integer,
      (select count(*) from placed where lane = 'domestic')::integer,
      (select count(*) from placed where lane = 'international')::integer,
      (select count(*) from placed where stream = 'saree')::integer,
      (select count(*) from placed where stream = 'service')::integer,
      (select count(*) from placed where stream = 'stitched')::integer,
      (select count(*) from placed where is_offline)::integer,
      (select count(*) from placed
        where not needs_address and dispatch_open_at::date <= $1)::integer,
      (select count(*) from shipped)::integer,
      (select count(*) from placed_still_open)::integer,
      (select count(*) from open_orders)::integer,
      (select min(placed_on) from open_orders),
      true
  $q$ using p_date;
end;
$$;

comment on function public.warehouse_day_orders(date) is
  'The orders half of the day sheet, counted from the dispatch board. Counts only: no order number, customer or address crosses this boundary. Answers zeros with board_connected = false where the dispatch schema is absent.';

grant execute on function public.warehouse_day_orders(date) to authenticated;
