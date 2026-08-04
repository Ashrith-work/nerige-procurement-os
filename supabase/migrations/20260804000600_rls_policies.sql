-- =============================================================================
-- M1 / 006 — Row Level Security policies
-- =============================================================================
-- Deny by default. RLS is enabled on every table; a table with RLS on and no
-- matching policy returns zero rows. Privileges are then granted back narrowly.
--
-- FORCE ROW LEVEL SECURITY is set on every table so that policies apply even to
-- the table owner. Without it, any connection that happens to run as owner
-- silently bypasses all isolation.
--
-- `anon` receives no privileges anywhere. Every table in this system requires
-- an authenticated session.
--
-- M1 write model is deliberately narrow: vendors have READ-ONLY access to their
-- own organisation's data. Vendor write paths (accepting POs, uploading
-- invoices, editing their own profile) arrive in M4 with their own policies and
-- their own isolation tests. Granting writes before there is a UI that needs
-- them is unearned attack surface.
-- =============================================================================

-- Start from zero. Supabase grants broad privileges on `public` by default;
-- we withdraw them and re-grant per table.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

alter table app_users            enable row level security;
alter table vendors              enable row level security;
alter table vendor_users         enable row level security;
alter table vendor_bank_accounts enable row level security;
alter table vendor_addresses     enable row level security;
alter table vendor_contacts      enable row level security;
alter table documents            enable row level security;
alter table audit_log            enable row level security;
alter table events               enable row level security;

alter table app_users            force row level security;
alter table vendors              force row level security;
alter table vendor_users         force row level security;
alter table vendor_bank_accounts force row level security;
alter table vendor_addresses     force row level security;
alter table vendor_contacts      force row level security;
alter table documents            force row level security;
alter table audit_log            force row level security;
alter table events               force row level security;

-- -----------------------------------------------------------------------------
-- app_users
-- -----------------------------------------------------------------------------
grant select on app_users to authenticated;
grant update on app_users to authenticated;   -- constrained to self by policy

-- Everyone can read their own profile. Without this the app cannot even
-- determine who is logged in.
create policy app_users_select_self on app_users
  for select to authenticated
  using (id = (select auth.uid()) and deleted_at is null);

create policy app_users_select_internal on app_users
  for select to authenticated
  using (app.is_internal() and deleted_at is null);

-- A vendor user may see co-workers in their own organisation — needed so the
-- portal can show "submitted by" on a colleague's action in M4.
create policy app_users_select_same_vendor on app_users
  for select to authenticated
  using (
    deleted_at is null
    and app.current_vendor_id() is not null
    and exists (
      select 1 from vendor_users vu
       where vu.user_id = app_users.id
         and vu.vendor_id = app.current_vendor_id()
         and vu.deleted_at is null
    )
  );

-- Self-service profile edits: display name and language only. Role and status
-- are pinned by the WITH CHECK below — a user must never be able to promote
-- themselves. Postgres has no column-level RLS, so the guard compares the
-- proposed row against the stored one.
--
-- The stored values come from SECURITY DEFINER helpers rather than an inline
-- subquery. Reading app_users from inside an app_users policy recurses
-- infinitely ("infinite recursion detected in policy for relation app_users").
-- The helpers run as owner and bypass RLS, breaking the cycle.
--
-- Fails closed for a suspended user: app.current_role() returns NULL for a
-- non-active account, so `role = NULL` yields NULL and the update is denied.
create policy app_users_update_self on app_users
  for update to authenticated
  using  (id = (select auth.uid()) and deleted_at is null)
  with check (
    id = (select auth.uid())
    and role   = app.current_role()
    and status = app.current_user_status()
    and deleted_at is null
  );

create policy app_users_manage_internal on app_users
  for update to authenticated
  using (app.can_manage_vendors())
  with check (app.can_manage_vendors());

-- INSERT is service-role only: user creation goes through the invite flow in
-- src/lib/auth, which must create the auth.users row and the app_users row
-- together. No client-side path exists.

-- -----------------------------------------------------------------------------
-- vendors
-- -----------------------------------------------------------------------------
grant select on vendors to authenticated;
grant insert, update on vendors to authenticated;

create policy vendors_select_internal on vendors
  for select to authenticated
  using (app.is_internal() and deleted_at is null);

-- The core isolation rule. A vendor sees exactly one vendor row: their own.
create policy vendors_select_own on vendors
  for select to authenticated
  using (app.owns_vendor_row(id) and deleted_at is null);

create policy vendors_insert_managed on vendors
  for insert to authenticated
  with check (app.can_manage_vendors());

create policy vendors_update_managed on vendors
  for update to authenticated
  using  (app.can_manage_vendors() and deleted_at is null)
  with check (app.can_manage_vendors());

-- -----------------------------------------------------------------------------
-- vendor_users
-- -----------------------------------------------------------------------------
grant select on vendor_users to authenticated;
grant insert, update on vendor_users to authenticated;

create policy vendor_users_select_internal on vendor_users
  for select to authenticated
  using (app.is_internal() and deleted_at is null);

create policy vendor_users_select_own on vendor_users
  for select to authenticated
  using (app.owns_vendor_row(vendor_id) and deleted_at is null);

create policy vendor_users_insert_managed on vendor_users
  for insert to authenticated
  with check (app.can_manage_vendors());

create policy vendor_users_update_managed on vendor_users
  for update to authenticated
  using  (app.can_manage_vendors())
  with check (app.can_manage_vendors());

-- -----------------------------------------------------------------------------
-- Vendor KYC satellites — identical shape, three tables
-- -----------------------------------------------------------------------------
-- Generated rather than hand-written: repeating this block by hand across
-- three tables now, and a dozen more in M3–M6, is exactly how one table ends up
-- missing its isolation clause.
do $$
declare
  t text;
begin
  foreach t in array array['vendor_bank_accounts', 'vendor_addresses', 'vendor_contacts']
  loop
    execute format('grant select, insert, update on %I to authenticated', t);

    execute format($p$
      create policy %I on %I
        for select to authenticated
        using (app.is_internal() and deleted_at is null)
    $p$, t || '_select_internal', t);

    execute format($p$
      create policy %I on %I
        for select to authenticated
        using (app.owns_vendor_row(vendor_id) and deleted_at is null)
    $p$, t || '_select_own', t);

    execute format($p$
      create policy %I on %I
        for insert to authenticated
        with check (app.can_manage_vendors())
    $p$, t || '_insert_managed', t);

    execute format($p$
      create policy %I on %I
        for update to authenticated
        using (app.can_manage_vendors() and deleted_at is null)
        with check (app.can_manage_vendors())
    $p$, t || '_update_managed', t);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- documents
-- -----------------------------------------------------------------------------
-- Note: this governs the metadata row only. The bytes in Supabase Storage are
-- protected separately in migration 007. Both are required — locking the table
-- while leaving the bucket open is the most common Supabase isolation failure.
grant select, insert, update on documents to authenticated;

create policy documents_select_internal on documents
  for select to authenticated
  using (app.is_internal() and deleted_at is null);

create policy documents_select_own on documents
  for select to authenticated
  using (app.owns_vendor_row(vendor_id) and deleted_at is null);

create policy documents_insert_managed on documents
  for insert to authenticated
  with check (app.can_manage_vendors());

create policy documents_update_managed on documents
  for update to authenticated
  using  (app.can_manage_vendors() and deleted_at is null)
  with check (app.can_manage_vendors());

-- -----------------------------------------------------------------------------
-- audit_log
-- -----------------------------------------------------------------------------
-- Founder and Procurement Head only. Vendors get no access whatsoever: the
-- trail spans all vendors and leaking it would expose competitors' terms.
-- Warehouse Manager is excluded as well — they have no need for it, and the
-- narrower the audience the more meaningful the trail stays.
grant select on audit_log to authenticated;

create policy audit_log_select_privileged on audit_log
  for select to authenticated
  using (app.can_manage_vendors());

-- No INSERT grant: rows arrive solely via the SECURITY DEFINER audit trigger.
-- No UPDATE/DELETE grant, and migration 003 blocks both at trigger level too.

-- -----------------------------------------------------------------------------
-- events
-- -----------------------------------------------------------------------------
-- No grants at all. The outbox is drained by n8n using the service role. There
-- is no legitimate client-side reason to read or write it, and its payloads
-- deliberately span vendors.
-- RLS is enabled with zero policies: closed to every authenticated caller.

comment on policy vendors_select_own on vendors is
  'Core vendor isolation. Combined with vendor_users_one_org_per_user, guarantees a vendor login resolves to exactly one vendor row.';
