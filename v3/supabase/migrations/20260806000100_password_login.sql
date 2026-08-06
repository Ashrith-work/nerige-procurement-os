-- Password sign-in replaces phone OTP and Google OAuth.
--
-- Every login is now a user ID and a password, both issued by the Nerige team.
-- Nobody signs themselves up, and no third-party provider is involved.
--
-- `app_users_vendor_needs_phone` existed because a weaver's phone number WAS
-- her login: without it there was no way to sign her in. That is no longer
-- true, and the constraint now blocks provisioning a weaver who has a user ID
-- but whose number nobody has written down yet.
--
-- The column stays, nullable. A phone number is still worth holding — it is how
-- Nerige actually reaches a weaver — it is simply no longer a credential.
-- app_users_phone_format still applies when a number IS present, and the
-- uniqueness index is already partial on `phone is not null`.
--
-- `app_users_internal_needs_email` is deliberately left in place. Every login
-- resolves to an email in auth.users (a real one for the Nerige team, an
-- internal one derived from the user ID for a weaver — see
-- src/lib/auth/user-id.ts), so an internal user without one cannot sign in.

alter table app_users drop constraint if exists app_users_vendor_needs_phone;

comment on column app_users.phone is
  'Contact number. Optional since password sign-in replaced phone OTP; no longer a credential.';
