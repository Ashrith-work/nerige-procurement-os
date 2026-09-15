-- =============================================================================
-- 032 — A sixth role: developer
-- =============================================================================
-- Alone in its file for the reason migration 020 gives: PostgreSQL forbids using
-- a newly added enum value in the transaction that added it, and Supabase wraps
-- each migration file in one transaction. Everything that uses 'developer' lands
-- in 033.
--
--   developer   The person who builds this system. Reads everything, writes
--               nothing, and can open any other role's screens exactly as that
--               person sees them. It exists so every dashboard can be checked
--               against real data without borrowing somebody's password and
--               without the checking itself changing anything.
--
-- `app_users_internal_needs_email` already requires an email for every
-- non-vendor role, which is right for this one too.
-- =============================================================================

alter type app_role add value if not exists 'developer';
