-- =============================================================================
-- 040 — It is the AI colour change, not "AE change"
-- =============================================================================
-- Migration 039 carried the movement over as `ae_change`, transcribed from the
-- manager's notebook page and flagged in that file as unconfirmed. It is the AI
-- COLOUR CHANGE: sarees taken off the floor to be recoloured, which is why they
-- leave the building and why a count of what came back is worth keeping.
--
-- `ALTER TYPE ... RENAME VALUE` rewrites the label in place, so every row
-- already written keeps its meaning and nothing has to be migrated. It is also
-- the one enum operation that needs no separate transaction, unlike ADD VALUE.
--
-- The columns on `warehouse_days` are renamed to match. A name that is wrong in
-- the database outlives every screen built on top of it: the next person reads
-- `ae_out`, invents a meaning for it, and writes code around the invention.
-- =============================================================================

alter type day_movement rename value 'ae_change' to 'ai_colour';

comment on type day_movement is
  'Where a saree went: to the customer experience centre, out for an AI colour change, or in front of a video call.';

alter table warehouse_days rename column ae_out  to ai_out;
alter table warehouse_days rename column ae_back to ai_back;

comment on column warehouse_days.ai_out is
  'Sarees sent out for an AI colour change on this day, as counted by the manager.';
