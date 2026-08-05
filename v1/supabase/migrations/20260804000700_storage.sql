-- =============================================================================
-- M1 / 007 — Supabase Storage buckets and object-level isolation
-- =============================================================================
-- This migration exists because table RLS is not enough.
--
-- The most common isolation failure in Supabase projects: the `documents` table
-- is correctly locked down, so Vendor B cannot see the metadata row for Vendor
-- A's GST certificate — but the bucket itself has no policy, so any
-- authenticated user who can guess or enumerate a storage path downloads the
-- file directly. The metadata was protected; the bytes were not.
--
-- The defence is a path convention enforced at both ends:
--   * documents.storage_path has a CHECK constraint requiring the
--     `vendors/{vendor_id}/...` prefix (migration 004)
--   * the policies below parse that same prefix out of storage.objects.name
--     and compare it to app.current_vendor_id()
--
-- Buckets are private. Files are served exclusively through short-lived signed
-- URLs generated server-side after an authorisation check.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'vendor-documents',
  'vendor-documents',
  false,                                    -- never public
  26214400,                                 -- 25 MB, matches documents.size_bytes
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic'                            -- vendors photograph documents on phones
  ]
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Extracts the vendor UUID from a storage path of the form
-- `vendors/{uuid}/...`. Returns NULL for any path that does not match, so a
-- malformed or crafted path fails closed rather than matching everything.
create or replace function app.storage_path_vendor_id(p_name text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_parts text[];
begin
  v_parts := string_to_array(p_name, '/');

  if array_length(v_parts, 1) < 3 or v_parts[1] <> 'vendors' then
    return null;
  end if;

  -- A non-UUID second segment is not an error condition, it is simply a
  -- non-matching path. Fail closed.
  begin
    return v_parts[2]::uuid;
  exception when invalid_text_representation then
    return null;
  end;
end;
$$;

grant execute on function app.storage_path_vendor_id(text) to authenticated;

-- Remove Supabase's permissive defaults if present in this project.
drop policy if exists "Give users access to own folder" on storage.objects;

-- --- Read ---------------------------------------------------------------------
create policy vendor_documents_read_internal on storage.objects
  for select to authenticated
  using (
    bucket_id = 'vendor-documents'
    and app.is_internal()
  );

create policy vendor_documents_read_own on storage.objects
  for select to authenticated
  using (
    bucket_id = 'vendor-documents'
    and app.owns_vendor_row(app.storage_path_vendor_id(name))
  );

-- --- Write --------------------------------------------------------------------
-- M1 mirrors the table policies: only Founder and Procurement Head upload.
-- Vendor self-upload arrives in M4 alongside the portal that needs it.
create policy vendor_documents_write_managed on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'vendor-documents'
    and app.can_manage_vendors()
    -- Reject any upload that does not conform to the isolation path layout.
    and app.storage_path_vendor_id(name) is not null
  );

create policy vendor_documents_update_managed on storage.objects
  for update to authenticated
  using      (bucket_id = 'vendor-documents' and app.can_manage_vendors())
  with check (bucket_id = 'vendor-documents' and app.can_manage_vendors());

-- No DELETE policy anywhere. Documents are soft-deleted at the metadata layer;
-- the underlying object is retained. A vendor invoice that can be erased is not
-- evidence, and M6's three-way match depends on the original being immutable.

comment on function app.storage_path_vendor_id(text) is
  'Parses vendors/{uuid}/... storage paths. Returns NULL on any non-conforming path so bucket policies fail closed.';
