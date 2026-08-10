-- =============================================================================
-- 019 — Purchase orders: a number, a file, and where it went
-- =============================================================================
-- A PO is not a new entity here. It is a document generated FROM an order, and
-- the order is still the record — so these are columns on `orders` rather than
-- a `purchase_orders` table.
--
-- That is a deliberate reversal of what the previous build did. `purchase_orders`
-- existed there as its own table with its own lines, and the two drifted: a PO
-- said one thing and the order said another, and nobody could say which had
-- been sent to the weaver. One row, one truth.
--
-- The PO NUMBER is allocated from a sequence and stored, because it is quoted
-- in emails and written on invoices months later. Regenerating the PDF must
-- produce the same number — a document whose identifier changes each time it is
-- printed is not an identifier.
-- =============================================================================

create sequence po_number_seq;

alter table orders
  add column po_number        text unique,
  add column po_generated_at  timestamptz,
  add column po_generated_by  uuid references app_users (id),

  -- Where it was filed. Both the id and the link: the id is what the API needs
  -- for a later call, the link is what a person clicks.
  add column po_drive_file_id text,
  add column po_drive_link    text,

  -- Slack's message timestamp doubles as its message id. Stored so a second
  -- send can be recognised as a second send rather than assumed to be the first.
  add column po_slack_ts      text,
  add column po_slack_channel text;

comment on column orders.po_number is
  'Allocated once and stored. Regenerating the PDF reuses it — an identifier that changes when reprinted is not one.';
comment on column orders.po_drive_link is
  'The Drive file, as a link a person can click. Null until it has been uploaded.';

/**
 * Allocate a PO number, once.
 *
 * Returns the existing number if there is one, so pressing "Generate PO" twice
 * produces the same document rather than burning a number per press. The
 * sequence is what makes allocation safe under concurrency; the read-then-write
 * this replaces would hand two admins the same number.
 */
create or replace function public.allocate_po_number(p_order_id uuid)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_existing text;
  v_prefix   text;
  v_number   text;
begin
  select po_number into v_existing from public.orders where id = p_order_id;
  if v_existing is not null then
    return v_existing;
  end if;

  select coalesce(po_prefix, 'NRG-PO') into v_prefix from public.app_settings where id = 1;

  v_number := v_prefix || '-' || lpad(nextval('public.po_number_seq')::text, 5, '0');

  update public.orders
     set po_number = v_number
   where id = p_order_id
     -- Belt and braces against two presses landing between the select and the
     -- update. The loser sees null and re-reads.
     and po_number is null;

  select po_number into v_existing from public.orders where id = p_order_id;
  return v_existing;
end;
$$;

comment on function public.allocate_po_number(uuid) is
  'Allocates a PO number once per order and returns the existing one thereafter. security_invoker: only someone who can update the order can allocate one.';

revoke all on function public.allocate_po_number(uuid) from public, anon;
grant execute on function public.allocate_po_number(uuid) to authenticated;
grant usage on sequence po_number_seq to authenticated;

-- The internal guard refuses identity changes and status moves; these are
-- neither, so it permits them without modification. The column-level grant is
-- what stops anything else on this table being written from a screen.
grant update (
  po_number,
  po_generated_at,
  po_generated_by,
  po_drive_file_id,
  po_drive_link,
  po_slack_ts,
  po_slack_channel
) on orders to authenticated;
