-- =============================================================================
-- 018 — An order can be delivered twice, so delivery is recorded per channel
-- =============================================================================
-- "Sent" was one fact: the order existed, therefore the weaver had it. That was
-- true while the portal was the only way to reach her, and it stops being true
-- the moment WhatsApp exists alongside it. A weaver who never opens the portal
-- and reads everything on WhatsApp, and one who has WhatsApp on a phone that is
-- not hers, are different people with the same order — and the question "has
-- she actually seen this?" has a different answer for each.
--
-- So each channel records its own timestamp. `dashboard_sent_at` is set when
-- the order is issued, because putting it in the portal IS delivering it there.
-- `whatsapp_sent_at` is only ever set by a successful send.
--
-- `whatsapp_status` tracks what Meta tells us afterwards through the webhook —
-- sent, delivered, read, failed. That distinction is the point: WhatsApp
-- accepting a message means it left, not that it arrived, and a wrong number
-- fails silently several minutes later. Without the webhook, "sent" would mean
-- "we handed it over and never checked".
-- =============================================================================

alter table orders
  -- Backfilled from issued_at: every existing order was delivered to the
  -- dashboard the moment it was created, and leaving these null would report
  -- the entire order history as never delivered anywhere.
  add column dashboard_sent_at    timestamptz,
  add column whatsapp_sent_at     timestamptz,
  add column whatsapp_message_id  text,
  add column whatsapp_status      text
    constraint orders_whatsapp_status_check
    check (whatsapp_status is null
           or whatsapp_status in ('queued', 'sent', 'delivered', 'read', 'failed')),
  add column whatsapp_error       text;

update orders set dashboard_sent_at = issued_at where dashboard_sent_at is null;

comment on column orders.dashboard_sent_at is
  'When this order became visible in the vendor portal. Set at issue: putting it there is delivering it there.';
comment on column orders.whatsapp_status is
  'What Meta last told us through the webhook. `sent` means it left us, not that it arrived — only `delivered` means that.';

-- Finding an order from a webhook, which arrives carrying only the message id.
create index orders_whatsapp_message_idx
  on orders (whatsapp_message_id) where whatsapp_message_id is not null;

-- -----------------------------------------------------------------------------
-- Both write guards already cover these, and neither needs changing
-- -----------------------------------------------------------------------------
-- This is worth stating because the instinct is to go and extend them.
--
-- `app.orders_internal_write_guard()` works by REFUSING specific changes —
-- identity columns, the weaver's three fields, and any status move except
-- cancel — rather than by permitting a list. New columns are therefore
-- writable by Nerige without touching it, which is exactly right for delivery
-- timestamps: recording that a WhatsApp message went is not a status move.
--
-- `app.orders_vendor_write_guard()` works the other way, permitting only the
-- promised date, the dispatch date and the docket. New columns are therefore
-- refused for a weaver by default. Also exactly right: whether Nerige managed
-- to WhatsApp her is not hers to edit.
--
-- Two guards, opposite defaults, and both defaults land correctly here. That is
-- luck the second time and design the first; it is written down so the next
-- person adding a column checks which side they are on.

grant update (
  status,
  dashboard_sent_at,
  whatsapp_sent_at,
  whatsapp_message_id,
  whatsapp_status,
  whatsapp_error
) on orders to authenticated;
