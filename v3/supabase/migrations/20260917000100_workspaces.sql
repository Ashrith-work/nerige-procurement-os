-- =============================================================================
-- 038 — Workspaces: one person, several jobs, one screen at a time
-- =============================================================================
-- The owner does three jobs in this application — orders sarees, signs off new
-- ones, reads the numbers — and until now the navigation offered all of them at
-- once, fourteen links deep, on every screen. That is not a menu, it is an
-- inventory, and it makes each of the three jobs harder to start.
--
-- A workspace is the job someone is doing now, named in their words: "Ordering
-- sarees", "New sarees", "The warehouse", "The numbers". It decides what the
-- navigation shows and where signing in lands. It is NOT a permission: the role
-- still decides what may be reached, and every screen a role may open stays
-- reachable by URL whatever workspace is open. Choosing a workspace narrows what
-- is in front of you; it can never widen what you are allowed to do.
--
-- WHY THE TEMPLATES ARE NOT ROWS. The four built-in workspaces live in
-- `src/lib/workspaces.ts`, not here. Seeding them per user would mean every new
-- account starts by copying four rows that then drift from the code that gives
-- them meaning — and a fifth template added later would reach nobody who signed
-- up before it. This table holds only what a PERSON changed: which one is their
-- default, ones they built themselves, ones they hid, and the order they like.
-- A user with no rows here gets the full set of templates their role allows,
-- which is the right answer on day one and needs no write to produce.
-- =============================================================================

create table user_workspaces (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references app_users (id) on delete restrict,

  -- A built-in template's key ('ordering'), or 'custom:<uuid>' for one somebody
  -- built. Text rather than an enum: a template added in code must not need a
  -- migration, and an enum value cannot be used in the transaction that adds it.
  key         text        not null check (length(trim(key)) between 1 and 60),

  -- Null means "as the template names it". Set only when renamed.
  name        text        check (name is null or length(trim(name)) between 1 and 40),

  -- The sections this workspace shows, in order. Null means the template's own
  -- list, so a template whose sections change in code reaches everyone who never
  -- customised it.
  sections    text[],

  -- Hidden rather than deleted, for templates: "I never do the warehouse job"
  -- is a preference, and a template cannot be deleted because it is not a row.
  hidden      boolean     not null default false,
  is_default  boolean     not null default false,
  sort        integer     not null default 0,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  unique (user_id, key)
);

-- One default per person, enforced rather than trusted: two defaults means the
-- landing screen depends on row order, which is how a person's home silently
-- changes on a Tuesday.
create unique index user_workspaces_one_default
  on user_workspaces (user_id) where is_default and not hidden;

create index user_workspaces_user_idx on user_workspaces (user_id, sort);

create trigger user_workspaces_touch
  before update on user_workspaces
  for each row execute function app.touch_row();

comment on table user_workspaces is
  'Per-person workspace preferences. Holds only what someone changed; the built-in templates live in src/lib/workspaces.ts.';
comment on column user_workspaces.sections is
  'Ordered section keys. Null means the template''s own list, so a template edited in code reaches everyone who never customised it.';

-- -----------------------------------------------------------------------------
-- Row Level Security — your own preferences, nobody else's
-- -----------------------------------------------------------------------------
-- Not even an admin may read these. A workspace list is a record of how a person
-- arranges their own working day; it decides nothing about the business and
-- there is no question anyone else can answer by reading it. The developer's
-- blanket read (migration 033) applies, because that is how the screens are
-- checked, and it carries no write.
alter table user_workspaces enable row level security;
alter table user_workspaces force row level security;

create policy user_workspaces_own on user_workspaces
  for all to authenticated
  using      (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

select app.grant_developer_read('public.user_workspaces');

grant select, insert, update, delete on user_workspaces to authenticated;
