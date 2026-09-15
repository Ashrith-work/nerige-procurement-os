-- =============================================================================
-- 034 — The warehouse floor staff's day, recorded by the manager
-- =============================================================================
-- Nerige has roughly six people on the warehouse floor. They have NO logins,
-- no devices and no screen of their own, and that is a decision rather than a
-- gap: a form system assumes a kind of literacy and a habit of self-reporting
-- that the floor does not have, and a login nobody uses is a login somebody
-- else ends up using on their behalf anyway.
--
-- So the model is a register, like a teacher taking attendance. The warehouse
-- manager records each person's day — attendance, rough counts of what they
-- did, anything that went wrong, one short note — and the founders review the
-- whole sheet. Nothing here is keyed to an `app_users` row for the person
-- being recorded; `floor_staff` is a roster of names, not of accounts.
--
-- WHAT THIS DELIBERATELY DOES NOT RECORD
--
--   * Per-pick timing. The reference figure the owner gave — about 37 picks an
--     hour — is a planning rate, not a measurement anyone can take under this
--     model. The manager writes "picked about 250 today"; there is no clock
--     behind that number and no column pretends there is.
--   * A zero for a day nobody filled in. A missing `staff_days` row is kept
--     missing. It is information in its own right — the manager did not get to
--     the sheet — and a review that silently read it as "absent" or "did
--     nothing" would blame the floor for the manager's fatigue.
--
-- THE EDIT WINDOW
--
-- The manager may change today and the seven days before it. The owner may
-- change any past day. Nobody may record a day that has not happened yet.
-- Enforced in RLS, not in the form: a register that can be quietly rewritten
-- a month later is not a register, and the only person who should be able to
-- do that is the person reviewing it. "Today" is the warehouse's today —
-- Asia/Kolkata — because the database runs in UTC and a sheet filled at
-- 1 a.m. IST would otherwise land on yesterday.
--
-- History is kept. A logged day, a count and a quality flag are never hard
-- deleted; a flag recorded by mistake is withdrawn (`removed_at`), and a
-- person who leaves is deactivated.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Capabilities
-- -----------------------------------------------------------------------------
-- Same four properties as migration 021, for the same reasons.

-- Who records the floor staff's day. The owner is included so a founder can
-- fill the sheet on a day the manager is away, and correct it afterwards.
create or replace function app.can_record_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(app.current_role() in ('admin', 'warehouse_manager'), false);
$$;

comment on function app.can_record_staff() is
  'Who records the warehouse floor staff sheet: admin and warehouse_manager. Mirrors requireStaffRecorder().';

-- The warehouse's calendar date. One definition, so the edit window, the
-- "not in the future" rule and the application's own "today" cannot disagree
-- about which day it is at 1 a.m.
create or replace function app.staff_today()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'Asia/Kolkata')::date;
$$;

comment on function app.staff_today() is
  'Today in Asia/Kolkata. The warehouse''s date, not the server''s. src/lib/performance/period.ts computes the same.';

-- Whether the caller may write the sheet for `p_work_date`.
--
-- Seven days is long enough to cover a manager who was off for a long weekend
-- and fills the sheet in on Monday, and short enough that last month's figures
-- are the figures. The constant is repeated as EDIT_WINDOW_DAYS in
-- src/lib/performance/period.ts so the screen can say a day is closed before
-- the database has to.
create or replace function app.can_edit_staff_day(p_work_date date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    p_work_date is not null
    and p_work_date <= app.staff_today()
    and (
      app.is_admin()
      or (
        app.current_role() = 'warehouse_manager'
        and p_work_date >= app.staff_today() - 7
      )
    ),
    false
  );
$$;

comment on function app.can_edit_staff_day(date) is
  'Edit window for the staff sheet: admin any past day; warehouse_manager today and the 7 days before; nobody a future day.';

grant execute on function
  app.can_record_staff(),
  app.staff_today(),
  app.can_edit_staff_day(date)
to authenticated;

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------

-- Four states and no more. "Late" and "left early" were considered and left
-- out: each is a judgement call the manager would make differently on
-- different days, and a half day already captures the part that affects a
-- target. If it matters, it goes in the note.
create type staff_attendance as enum ('present', 'half_day', 'absent', 'leave');

-- What went wrong. An enum rather than free text because the review counts
-- them by kind, and "wrong item", "Wrong Item" and "wrong pick" would
-- otherwise be three categories of one mistake.
create type staff_flag_kind as enum ('wrong_item', 'damage', 'repack', 'other');

-- -----------------------------------------------------------------------------
-- Shared trigger: who wrote this
-- -----------------------------------------------------------------------------
-- Stamped by the database rather than supplied by the form, so `recorded_by`
-- is the person whose session made the write and cannot be set to somebody
-- else. Falls back to the supplied value only when there is no session at all
-- — a migration or a test fixture — which is why the column stays NOT NULL.
create or replace function app.stamp_staff_recorder()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.recorded_by := coalesce(auth.uid(), new.recorded_by);
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- floor_staff — the roster
-- -----------------------------------------------------------------------------
create table floor_staff (
  id              uuid        primary key default gen_random_uuid(),

  -- What the manager calls them on the floor. One field, not first/last: the
  -- sheet shows exactly what is typed here, and "Lakshmi (packing)" is a
  -- perfectly good name for this purpose.
  display_name    text        not null
                              check (length(trim(display_name)) between 1 and 60),

  -- Bounds the days this person is EXPECTED on the sheet. Without them a
  -- person who joined on the 20th would show nineteen unfilled days that
  -- month, and a person who left would keep generating gaps forever — both
  -- of which would read as the manager not doing the sheet.
  started_on      date        not null default app.staff_today(),
  active          boolean     not null default true,
  deactivated_on  date,

  created_by      uuid        references app_users (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  version         integer     not null default 1,

  constraint floor_staff_deactivated_together
    check (active = (deactivated_on is null)),
  constraint floor_staff_left_after_joining
    check (deactivated_on is null or deactivated_on >= started_on)
);

-- Two active people with the same name would be two indistinguishable rows on
-- a sheet filled in at speed. Partial, so a former employee's name can return.
create unique index floor_staff_active_name_uniq
  on floor_staff (lower(trim(display_name))) where active;

create trigger floor_staff_touch
  before update on floor_staff
  for each row execute function app.touch_row();

-- A person is never deleted: their days reference them, and a founder asking
-- "how did the old packer do in March" must still get an answer.
create trigger floor_staff_no_hard_delete
  before delete on floor_staff
  for each row execute function app.forbid_hard_delete();

comment on table floor_staff is
  'Warehouse floor staff. Names only — these people have no login. Deactivated, never deleted.';

-- -----------------------------------------------------------------------------
-- staff_tasks — what can be counted, and the coarse target for a full day
-- -----------------------------------------------------------------------------
-- A text code as the key rather than a uuid so a count row is readable in a
-- plain SELECT, and so the seed below is stable across environments.
create table staff_tasks (
  code            text        primary key
                              check (code ~ '^[a-z][a-z0-9_]{0,31}$'),
  label           text        not null
                              check (length(trim(label)) between 1 and 40),

  -- Units per FULL day of doing only this task. Nullable on purpose: a task
  -- nobody has agreed a number for shows its count and no percentage, which
  -- is honest, rather than a percentage against a made-up target.
  target_per_day  integer     check (target_per_day is null or target_per_day > 0),

  sort_order      integer     not null default 100,
  -- Retired, not deleted, for the same reason as master_data: last year's
  -- counts must keep resolving to a label.
  active          boolean     not null default true,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  version         integer     not null default 1
);

create trigger staff_tasks_touch
  before update on staff_tasks
  for each row execute function app.touch_row();

create trigger staff_tasks_no_hard_delete
  before delete on staff_tasks
  for each row execute function app.forbid_hard_delete();

comment on table staff_tasks is
  'Countable warehouse tasks and a coarse per-full-day target. A half day counts as 0.5 of the target.';
comment on column staff_tasks.target_per_day is
  'Units in a full working day spent only on this task. NULL means no agreed target: the review shows the count without a percentage.';

-- The seed. Every target except picking is left NULL for the owner to set at
-- /admin/performance/targets — nobody has given a number for them, and a
-- guessed target would make somebody look slow on day one.
--
-- ASSUMPTION FOR THE OWNER TO CONFIRM: picking at 259 per day is the one
-- reference rate given (about 37 units an hour, roughly 1m37s a pick)
-- multiplied by an ASSUMED 7 productive hours. If the floor works 8 hours
-- with an hour's break, or picks in shorter stints between packing, this
-- number is wrong and should be changed on the targets screen.
insert into staff_tasks (code, label, target_per_day, sort_order) values
  ('pick',      'Pick',         259, 10),
  ('pack',      'Pack',         null, 20),
  ('fold',      'Fold',         null, 30),
  ('fall_pico', 'Fall & pico',  null, 40),
  ('tassels',   'Tassels',      null, 50),
  ('inward',    'Inward',       null, 60),
  ('shoot',     'Shoot',        null, 70),
  ('other',     'Other',        null, 80);

-- -----------------------------------------------------------------------------
-- staff_days — one person, one day
-- -----------------------------------------------------------------------------
-- The existence of this row IS "the manager recorded this person on this
-- day". Attendance is therefore NOT NULL: there is no half-recorded state that
-- would have to be told apart from an unrecorded one.
create table staff_days (
  staff_id     uuid             not null references floor_staff (id),
  work_date    date             not null,
  attendance   staff_attendance not null,

  -- One short line. Long enough for "left at 3, sister's wedding", short
  -- enough that nobody writes an appraisal in it.
  note         text             check (note is null or length(note) <= 280),

  recorded_by  uuid             not null references app_users (id),
  created_at   timestamptz      not null default now(),
  updated_at   timestamptz      not null default now(),
  version      integer          not null default 1,

  primary key (staff_id, work_date)
);

-- The review reads by date range across everybody.
create index staff_days_date_idx on staff_days (work_date);

create trigger staff_days_recorder
  before insert or update on staff_days
  for each row execute function app.stamp_staff_recorder();

create trigger staff_days_touch
  before update on staff_days
  for each row execute function app.touch_row();

create trigger staff_days_no_hard_delete
  before delete on staff_days
  for each row execute function app.forbid_hard_delete();

comment on table staff_days is
  'One row per floor-staff member per day the manager recorded them. A missing row is an unfilled sheet, never an absence.';

-- -----------------------------------------------------------------------------
-- staff_day_counts — rough throughput
-- -----------------------------------------------------------------------------
-- Keyed to the day, so a count cannot exist for a day that was not recorded.
-- A count cleared on the sheet is set to zero rather than deleted: the row
-- stays, with who changed it and when.
create table staff_day_counts (
  staff_id     uuid        not null,
  work_date    date        not null,
  task_code    text        not null references staff_tasks (code),
  quantity     integer     not null check (quantity between 0 and 100000),

  recorded_by  uuid        not null references app_users (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  version      integer     not null default 1,

  primary key (staff_id, work_date, task_code),
  foreign key (staff_id, work_date) references staff_days (staff_id, work_date)
);

create index staff_day_counts_date_idx on staff_day_counts (work_date);

create trigger staff_day_counts_recorder
  before insert or update on staff_day_counts
  for each row execute function app.stamp_staff_recorder();

create trigger staff_day_counts_touch
  before update on staff_day_counts
  for each row execute function app.touch_row();

create trigger staff_day_counts_no_hard_delete
  before delete on staff_day_counts
  for each row execute function app.forbid_hard_delete();

comment on table staff_day_counts is
  'Coarse daily counts per task — "packed about 60". Not a stopwatch; no per-unit timing exists or is implied.';

-- -----------------------------------------------------------------------------
-- staff_quality_flags — something went wrong
-- -----------------------------------------------------------------------------
create table staff_quality_flags (
  id           uuid            primary key default gen_random_uuid(),
  staff_id     uuid            not null,
  work_date    date            not null,
  kind         staff_flag_kind not null,

  -- Optional, and free text: a Shopify order name ("#10432"), an AWB, or
  -- nothing. The manager may not have it to hand, and a required field here
  -- is how a flag goes unrecorded.
  order_ref    text            check (order_ref is null or length(trim(order_ref)) between 1 and 60),
  note         text            check (note is null or length(note) <= 280),

  recorded_by  uuid            not null references app_users (id),

  -- Withdrawn, not deleted. A flag against a named person is the one record
  -- here somebody might want quietly gone; it can be withdrawn inside the
  -- edit window, and the withdrawal is itself on the record.
  removed_at   timestamptz,
  removed_by   uuid            references app_users (id),

  created_at   timestamptz     not null default now(),
  updated_at   timestamptz     not null default now(),
  version      integer         not null default 1,

  foreign key (staff_id, work_date) references staff_days (staff_id, work_date),
  constraint staff_quality_flags_removed_together
    check ((removed_at is null) = (removed_by is null))
);

create index staff_quality_flags_date_idx on staff_quality_flags (work_date)
  where removed_at is null;

-- A flag's author is stamped at creation and never rewritten by a later
-- edit; a withdrawal is stamped with whoever withdrew it.
create or replace function app.stamp_staff_flag()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.recorded_by := coalesce(auth.uid(), new.recorded_by);
  else
    new.recorded_by := old.recorded_by;
    if new.removed_at is not null and old.removed_at is null then
      new.removed_by := coalesce(auth.uid(), new.removed_by);
    end if;
  end if;
  return new;
end;
$$;

create trigger staff_quality_flags_stamp
  before insert or update on staff_quality_flags
  for each row execute function app.stamp_staff_flag();

create trigger staff_quality_flags_touch
  before update on staff_quality_flags
  for each row execute function app.touch_row();

create trigger staff_quality_flags_no_hard_delete
  before delete on staff_quality_flags
  for each row execute function app.forbid_hard_delete();

comment on table staff_quality_flags is
  'Quality problems attributed to a person on a day: wrong item, damage, re-pack, other. Withdrawn with removed_at, never deleted.';

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
-- Readable by the two roles that record or review it, and by the developer.
-- NOT by procurement or customer support: this is a record of named people's
-- attendance and mistakes, and neither job needs it. Not `is_staff()`.
alter table floor_staff         enable row level security;
alter table staff_tasks         enable row level security;
alter table staff_days          enable row level security;
alter table staff_day_counts    enable row level security;
alter table staff_quality_flags enable row level security;

alter table floor_staff         force row level security;
alter table staff_tasks         force row level security;
alter table staff_days          force row level security;
alter table staff_day_counts    force row level security;
alter table staff_quality_flags force row level security;

-- floor_staff: the manager keeps the roster — adds a new hire, deactivates a
-- leaver — without waiting on a founder. No delete policy; the trigger would
-- refuse it anyway.
create policy floor_staff_read on floor_staff
  for select to authenticated
  using ((select app.can_record_staff()));

create policy floor_staff_insert on floor_staff
  for insert to authenticated
  with check ((select app.can_record_staff()));

create policy floor_staff_update on floor_staff
  for update to authenticated
  using      ((select app.can_record_staff()))
  with check ((select app.can_record_staff()));

-- staff_tasks: the manager reads them to draw the sheet; only the owner sets
-- what a good day looks like. The person being measured against a target —
-- or recording others against one — does not set it.
create policy staff_tasks_read on staff_tasks
  for select to authenticated
  using ((select app.can_record_staff()));

create policy staff_tasks_admin_insert on staff_tasks
  for insert to authenticated
  with check ((select app.is_admin()));

create policy staff_tasks_admin_update on staff_tasks
  for update to authenticated
  using      ((select app.is_admin()))
  with check ((select app.is_admin()));

-- The three day tables share one rule. USING checks the row as it is, WITH
-- CHECK the row as it will be — so a manager can neither edit a closed day
-- nor move an open day's row onto a closed date.
create policy staff_days_read on staff_days
  for select to authenticated
  using ((select app.can_record_staff()));

create policy staff_days_insert on staff_days
  for insert to authenticated
  with check (app.can_edit_staff_day(work_date));

create policy staff_days_update on staff_days
  for update to authenticated
  using      (app.can_edit_staff_day(work_date))
  with check (app.can_edit_staff_day(work_date));

create policy staff_day_counts_read on staff_day_counts
  for select to authenticated
  using ((select app.can_record_staff()));

create policy staff_day_counts_insert on staff_day_counts
  for insert to authenticated
  with check (app.can_edit_staff_day(work_date));

create policy staff_day_counts_update on staff_day_counts
  for update to authenticated
  using      (app.can_edit_staff_day(work_date))
  with check (app.can_edit_staff_day(work_date));

create policy staff_quality_flags_read on staff_quality_flags
  for select to authenticated
  using ((select app.can_record_staff()));

create policy staff_quality_flags_insert on staff_quality_flags
  for insert to authenticated
  with check (app.can_edit_staff_day(work_date));

create policy staff_quality_flags_update on staff_quality_flags
  for update to authenticated
  using      (app.can_edit_staff_day(work_date))
  with check (app.can_edit_staff_day(work_date));

select app.grant_developer_read('public.floor_staff');
select app.grant_developer_read('public.staff_tasks');
select app.grant_developer_read('public.staff_days');
select app.grant_developer_read('public.staff_day_counts');
select app.grant_developer_read('public.staff_quality_flags');

-- No DELETE anywhere. History is the point.
grant select, insert, update on floor_staff         to authenticated;
grant select, insert, update on staff_tasks         to authenticated;
grant select, insert, update on staff_days          to authenticated;
grant select, insert, update on staff_day_counts    to authenticated;
grant select, insert, update on staff_quality_flags to authenticated;

revoke all on floor_staff, staff_tasks, staff_days, staff_day_counts, staff_quality_flags from anon;

-- -----------------------------------------------------------------------------
-- save_staff_sheet — the one Save button
-- -----------------------------------------------------------------------------
-- The whole sheet in one call and one transaction. Six people, eight counts
-- each, a few flags: done as separate PostgREST requests, a dropped tablet
-- connection halfway through would leave three people saved and three not,
-- and the manager would have no way to tell which from the screen.
--
-- SECURITY INVOKER, deliberately. Every write below goes through the caller's
-- own RLS policies, so this function adds convenience and a readable error
-- and grants no authority at all. The edit-window check at the top exists
-- only to say "that day is closed" in a sentence rather than as a policy
-- violation; the policies are the guarantee.
--
-- p_entries is an array of:
--   {
--     "staff_id":        uuid,
--     "attendance":      "present" | "half_day" | "absent" | "leave" | null,
--     "note":            text | null,
--     "counts":          { "<task_code>": integer | null, ... },
--     "add_flags":       [ { "kind": ..., "order_ref": text|null, "note": text|null } ],
--     "remove_flag_ids": [ uuid ]
--   }
-- An entry with null attendance is skipped — that person is simply not
-- recorded yet — unless it carries work or a flag, which is refused: a count
-- for someone not marked present is a mis-tap, not data.
create or replace function public.save_staff_sheet(p_work_date date, p_entries jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_entry      jsonb;
  v_staff      uuid;
  v_name       text;
  v_attendance public.staff_attendance;
  v_count      record;
  v_flag       jsonb;
  v_saved      integer := 0;
  v_has_work   boolean;
begin
  if not app.can_edit_staff_day(p_work_date) then
    raise exception 'The sheet for % cannot be changed from this account.', p_work_date
      using errcode = 'insufficient_privilege',
            hint    = 'The warehouse manager may change today and the 7 days before it. Older days need a founder.';
  end if;

  if jsonb_typeof(coalesce(p_entries, '[]'::jsonb)) <> 'array' then
    raise exception 'p_entries must be an array.' using errcode = 'invalid_parameter_value';
  end if;

  for v_entry in select * from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb)) loop
    v_staff := (v_entry ->> 'staff_id')::uuid;
    v_attendance := nullif(v_entry ->> 'attendance', '')::public.staff_attendance;

    select display_name into v_name from public.floor_staff where id = v_staff;
    if v_name is null then
      raise exception 'No such staff member: %.', v_staff using errcode = 'no_data_found';
    end if;

    v_has_work :=
      exists (
        select 1 from jsonb_each_text(coalesce(v_entry -> 'counts', '{}'::jsonb)) c
         where c.value is not null and c.value::integer > 0
      )
      or jsonb_array_length(coalesce(v_entry -> 'add_flags', '[]'::jsonb)) > 0;

    if v_attendance is null then
      if v_has_work then
        raise exception 'Mark attendance for % before recording their work.', v_name
          using errcode = 'check_violation';
      end if;
      continue;
    end if;

    -- Absent or on leave and also packed forty sarees is a tap on the wrong
    -- row. Refused rather than stored, because the review would otherwise
    -- show output against a target of zero.
    if v_attendance in ('absent', 'leave') and exists (
      select 1 from jsonb_each_text(coalesce(v_entry -> 'counts', '{}'::jsonb)) c
       where c.value is not null and c.value::integer > 0
    ) then
      raise exception '% is marked %, but has work counted.', v_name, replace(v_attendance::text, '_', ' ')
        using errcode = 'check_violation';
    end if;

    insert into public.staff_days (staff_id, work_date, attendance, note, recorded_by)
    values (
      v_staff, p_work_date, v_attendance,
      nullif(trim(coalesce(v_entry ->> 'note', '')), ''),
      auth.uid()
    )
    on conflict (staff_id, work_date) do update
      set attendance = excluded.attendance,
          note       = excluded.note;

    for v_count in
      select c.key as task_code, nullif(c.value, '')::integer as quantity
        from jsonb_each_text(coalesce(v_entry -> 'counts', '{}'::jsonb)) c
    loop
      if v_count.quantity is null then
        -- Cleared on the sheet. Zero an existing count; never invent a row
        -- for a box that was always empty.
        update public.staff_day_counts
           set quantity = 0
         where staff_id = v_staff and work_date = p_work_date
           and task_code = v_count.task_code and quantity <> 0;
      else
        insert into public.staff_day_counts (staff_id, work_date, task_code, quantity, recorded_by)
        values (v_staff, p_work_date, v_count.task_code, v_count.quantity, auth.uid())
        on conflict (staff_id, work_date, task_code) do update
          set quantity = excluded.quantity
          where public.staff_day_counts.quantity is distinct from excluded.quantity;
      end if;
    end loop;

    for v_flag in select * from jsonb_array_elements(coalesce(v_entry -> 'add_flags', '[]'::jsonb)) loop
      insert into public.staff_quality_flags (staff_id, work_date, kind, order_ref, note, recorded_by)
      values (
        v_staff, p_work_date,
        (v_flag ->> 'kind')::public.staff_flag_kind,
        nullif(trim(coalesce(v_flag ->> 'order_ref', '')), ''),
        nullif(trim(coalesce(v_flag ->> 'note', '')), ''),
        auth.uid()
      );
    end loop;

    update public.staff_quality_flags
       set removed_at = now(), removed_by = auth.uid()
     where staff_id = v_staff
       and work_date = p_work_date
       and removed_at is null
       and id in (
         select (x #>> '{}')::uuid
           from jsonb_array_elements(coalesce(v_entry -> 'remove_flag_ids', '[]'::jsonb)) x
       );

    v_saved := v_saved + 1;
  end loop;

  return v_saved;
end;
$$;

comment on function public.save_staff_sheet(date, jsonb) is
  'Saves the whole floor-staff sheet for one day atomically. SECURITY INVOKER: every write is checked by the caller''s own RLS policies. Returns the number of people recorded.';

revoke all on function public.save_staff_sheet(date, jsonb) from public, anon;
grant execute on function public.save_staff_sheet(date, jsonb) to authenticated;
