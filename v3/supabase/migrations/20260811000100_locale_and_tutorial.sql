-- =============================================================================
-- 011 — Language belongs to the weaver, and a video that explains the job
-- =============================================================================
-- Two changes, both about the same person: the woman at the loom who opens this
-- on a phone and has never been shown how it works.
--
-- LANGUAGE. It was a single `app_users.locale`, defaulting to English, set when
-- an account was provisioned from a laptop. That is the wrong shape. The fact
-- worth storing is that the Gadwal weaver's house is Telugu speaking — a
-- property of the VENDOR, set once by the admin — and the second login at that
-- weaver who happens to read Kannada is the exception, not the rule.
--
-- So: `vendors.default_locale` is the fact, and `app_users.locale_override` is
-- the exception. Resolution is override, then vendor default, then English, and
-- it is written down once in `resolveLocale()`.
--
-- `locale` is RENAMED rather than joined by a second column. Two columns both
-- meaning "her language" is how one of them ends up stale, and this way the
-- compiler finds every reader.
--
-- Nulling the rows that say 'en' is not cosmetic either. Every account was
-- created with the default, so 'en' recorded a default rather than a decision —
-- and left in place it would out-rank the vendor default the admin sets and
-- keep her portal in English.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- vendors.default_locale — the language the admin sets for a weaver
-- -----------------------------------------------------------------------------
alter table vendors
  add column default_locale text not null default 'en'
    constraint vendors_default_locale_check
    check (default_locale in ('en', 'kn', 'ta', 'te', 'hi'));

comment on column vendors.default_locale is
  'The language this weaver''s portal opens in, set by the admin. Beaten only by an explicit app_users.locale_override.';

-- -----------------------------------------------------------------------------
-- app_users.locale_override — the exception, and nullable because it is one
-- -----------------------------------------------------------------------------
alter table app_users rename column locale to locale_override;

alter table app_users drop constraint if exists app_users_locale_check;

alter table app_users
  alter column locale_override drop not null,
  alter column locale_override drop default;

-- 'en' was the column default on every row, so it records a default and not a
-- choice. Left as-is it would win over the vendor default and quietly keep a
-- Telugu weaver's portal in English.
update app_users set locale_override = null where locale_override = 'en';

alter table app_users
  add constraint app_users_locale_override_check
  check (locale_override is null or locale_override in ('en', 'kn', 'ta', 'te', 'hi'));

comment on column app_users.locale_override is
  'This login''s own language choice, or null to follow the vendor default. Written by the picker in her own header.';

-- -----------------------------------------------------------------------------
-- tutorial_videos — the film that explains the job
-- -----------------------------------------------------------------------------
-- One active video per language, chosen by the resolved locale with English as
-- the fallback. The unique index is what makes "pick the row matching her
-- locale" a single row rather than whichever one came back first.
--
-- Not vendor-scoped, on purpose: it is the same explanation of the same process
-- for everybody, and scoping it per weaver would mean uploading fifty-three
-- copies of one film.
create table tutorial_videos (
  id          uuid        primary key default gen_random_uuid(),

  locale      text        not null
                          constraint tutorial_videos_locale_check
                          check (locale in ('en', 'kn', 'ta', 'te', 'hi')),

  -- Stored as the URL the admin pasted, in whichever of YouTube's six forms it
  -- came in. The video ID is parsed at render time rather than at write time,
  -- so a paste that this parser does not yet understand is a fixable bug and
  -- not a row that has already lost the original.
  youtube_url text        not null check (length(trim(youtube_url)) between 1 and 500),

  title       text        not null check (length(trim(title)) between 1 and 200),
  caption     text,
  is_active   boolean     not null default true,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index tutorial_videos_one_active_per_locale
  on tutorial_videos (locale) where is_active;

create trigger tutorial_videos_touch
  before update on tutorial_videos
  for each row execute function app.touch_row();

comment on table tutorial_videos is
  'The how-this-works film, one active row per language. Every vendor sees the row for her resolved locale, or the English one.';

-- -----------------------------------------------------------------------------
-- Isolation
-- -----------------------------------------------------------------------------
-- Forced, like every other table here, so the rule holds even for the owner.
-- Read by everybody who is signed in; written only by the Nerige team.
alter table tutorial_videos enable row level security;
alter table tutorial_videos force row level security;

create policy tutorial_videos_select_all on tutorial_videos
  for select to authenticated
  using (is_active or (select app.is_internal()));

create policy tutorial_videos_write_internal on tutorial_videos
  for all to authenticated
  using      ((select app.is_internal()))
  with check ((select app.is_internal()));

grant select on tutorial_videos to authenticated;
grant insert, update, delete on tutorial_videos to authenticated;
