-- =============================================================================
-- 013 — Issuing a weaver her login, without ever storing her password
-- =============================================================================
-- The requirement was: create a vendor account from the admin panel, show the
-- password ONCE, and — separately — let the admin see when a vendor last got
-- credentials. The instruction was explicit that if those could not both be
-- satisfied without storing plain text, that should be said rather than worked
-- around.
--
-- They can, and this is how. The password is generated in memory, handed to
-- Supabase Auth (which stores only a bcrypt hash), rendered once into the
-- response that created it, and never written anywhere by us. What IS stored is
-- the METADATA of the issuing: when, and by whom.
--
-- That metadata answers every question the admin actually has. "Has HDR been
-- given credentials?" — yes, on 4 August. "Did anyone re-issue them after she
-- rang?" — yes, by Pooja, yesterday. "What is her password?" — nobody at Nerige
-- can answer that, including the database, and the correct action is to issue a
-- new one, which takes one click and is logged.
--
-- Reversible encryption was the other option and is worse than useless here: a
-- key that the application can decrypt with is a key an attacker who reaches
-- the application can decrypt with, so it converts "passwords are safe" into
-- "passwords are as safe as one environment variable" while looking prudent.
-- =============================================================================

alter table app_users
  add column credential_issued_at timestamptz,
  add column credential_issued_by uuid references app_users (id);

comment on column app_users.credential_issued_at is
  'When a password was last generated for this login. The password itself is not stored anywhere, in any form.';
comment on column app_users.credential_issued_by is
  'Which Nerige admin issued it. Answers "who gave her this login" without answering "what is it".';

-- -----------------------------------------------------------------------------
-- vendors.whatsapp_number — where an order gets sent
-- -----------------------------------------------------------------------------
-- Separate from `primary_phone` on purpose. The number a weaver answers calls on
-- and the number registered to her WhatsApp are frequently not the same handset
-- in a house with one smartphone and two SIMs, and sending an order to the
-- wrong one fails silently — WhatsApp accepts the send and nobody ever reads it.
--
-- Stored E.164, country code included, because the Cloud API takes nothing else
-- and a ten-digit Indian number with the +91 assumed is the single most common
-- way these sends fail.
alter table vendors
  add column whatsapp_number text
    constraint vendors_whatsapp_format
    check (whatsapp_number is null or whatsapp_number ~ '^\+[1-9][0-9]{7,14}$');

comment on column vendors.whatsapp_number is
  'E.164 with country code, e.g. +919876543210. Where WhatsApp order messages go; not necessarily primary_phone.';

-- -----------------------------------------------------------------------------
-- Creating a login needs the admin to be able to write app_users and vendors
-- -----------------------------------------------------------------------------
-- `app_users_manage_internal` already grants UPDATE to internal users. INSERT
-- was never granted to anybody, because until now the only thing that created a
-- profile was a script holding the service-role key.
--
-- The admin panel still cannot create the auth.users row under RLS — that is
-- Supabase's table and no policy of ours reaches it — so the server action uses
-- the service-role client for that one call and then writes the profile as
-- itself, under these policies. The narrower the service-role blast radius, the
-- better.
create policy app_users_insert_internal on app_users
  for insert to authenticated
  with check ((select app.is_internal()));

create policy vendors_insert_internal on vendors
  for insert to authenticated
  with check ((select app.is_internal()));

create policy vendors_update_internal on vendors
  for update to authenticated
  using      ((select app.is_internal()))
  with check ((select app.is_internal()));

create policy vendor_users_insert_internal on vendor_users
  for insert to authenticated
  with check ((select app.is_internal()));

grant insert on app_users to authenticated;
grant insert, update on vendors to authenticated;
grant insert on vendor_users to authenticated;
