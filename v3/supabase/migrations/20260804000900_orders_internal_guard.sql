-- =============================================================================
-- 009 — What Pooja may write on an order she has already sent
-- =============================================================================
-- "/orders and /orders/[id] — Pooja. Issued orders and their state. Read only
-- apart from cancel." (spec §5)
--
-- That is a rule about state, so it lives with the state. Disabling a button is
-- how a screen communicates the rule; it is not how the rule is kept. An order
-- is a commitment a weaver has already started work against, and the two ways
-- to break it are silently editing what was asked for and cancelling something
-- that is already on a truck.
--
-- The vendor side of the same question is `app.orders_vendor_write_guard()` in
-- migration 006. Two guards rather than one because they answer to two
-- different people: this one returns immediately for a vendor session, and that
-- one returns immediately for anyone who is not a vendor.
--
-- Neither guard applies to the database owner. The seed loader and
-- `issue_orders` run there, and infrastructure is trusted by construction.
-- =============================================================================

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
     and not (new.status = 'cancelled' and old.status in ('issued', 'accepted')) then
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

create trigger orders_internal_write_guard_trg
  before update on orders
  for each row execute function app.orders_internal_write_guard();

comment on function app.orders_internal_write_guard() is
  'Procurement may cancel an issued or accepted order. That is the whole of its write surface on orders.';
