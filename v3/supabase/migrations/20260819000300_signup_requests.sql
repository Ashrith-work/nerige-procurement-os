-- =============================================================================
-- 028 — Asking for an account, and an owner who grants it
-- =============================================================================
-- Until now the only way to get a login was `npm run provision`, run by hand on
-- somebody's laptop. That is a real ceiling: a weaver who wants access has to
-- reach a person who has the repo checked out.
--
-- WHAT THIS DOES NOT DO. It does not create accounts. A signup request is an
-- ASKING, stored in its own table, and no row here has any authority at all
-- until an admin approves it — at which point application code creates the auth
-- user, exactly as the provisioning script always has. Migration 009 replaced
-- OAuth and OTP with issued credentials specifically because both of those
-- create an account as a side effect of someone merely arriving. That property
-- is preserved here: arriving still creates nothing.
--
-- HOW A STRANGER REACHES THIS TABLE, AND WHY NOT DIRECTLY. `anon` has no grant
-- on any table in this schema and does not acquire one here. The form calls a
-- single SECURITY DEFINER function, `public.request_signup`, which validates
-- and inserts. So the wire surface is one function with a fixed signature
-- rather than a table with an INSERT policy — nothing can be selected, nothing
-- updated, and the shape of what may be written is decided in one place.
--
-- NO PASSWORD IS COLLECTED, and this is the load-bearing decision. A password
-- captured at signup would have to sit somewhere until an admin got round to
-- approving it, and the only forms it could sit in are plaintext or something
-- reversible — Supabase Auth's admin API takes a plaintext password and will
-- not accept a hash we computed ourselves, so "just store the bcrypt" is not
-- available. Instead approval mints a one-time password, shown to the admin
-- once, and passed on however that weaver is already spoken to. It is the
-- invitation flow with a request step in front, not a new credential path.
--
-- ADMIN CANNOT BE REQUESTED. Approval is required for every role, so asking for
-- `admin` is not privilege escalation in itself — but a form that offers
-- ownership of the whole system as a dropdown option is one mis-click by one
-- tired approver away from giving it away. It is not offered.
-- =============================================================================

create type signup_status as enum ('pending', 'approved', 'rejected');

create table signup_requests (
  id             uuid        primary key default gen_random_uuid(),

  -- What they typed, normalised the same way the sign-in box normalises it, so
  -- "HDR " from a phone with autocapitalise on cannot become a second identity
  -- from the same person. See src/lib/auth/user-id.ts.
  user_id        text        not null
                             check (length(trim(user_id)) between 2 and 254),
  full_name      text        not null
                             check (length(trim(full_name)) between 1 and 120),

  -- Deliberately not the app_role enum. That type contains 'admin', and a
  -- column typed as it would permit an admin request to exist even though the
  -- function refuses to create one. The CHECK states the rule where it cannot
  -- be bypassed by a future caller.
  requested_role text        not null
                             check (requested_role in
                               ('vendor', 'warehouse_manager', 'customer_support', 'procurement_head')),

  -- Free text, verified by a human at approval. NOT a foreign key onto vendors:
  -- a wrong code must produce a conversation, not a constraint violation on a
  -- public form, and a real key here would let a stranger probe which vendor
  -- codes exist by watching which submissions succeed.
  vendor_code    text        check (vendor_code is null or length(trim(vendor_code)) between 1 and 16),
  phone          text        check (phone is null or length(trim(phone)) between 4 and 20),
  note           text        check (note is null or length(note) <= 500),

  status         signup_status not null default 'pending',
  decided_by     uuid        references app_users(id),
  decided_at     timestamptz,
  decision_note  text        check (decision_note is null or length(decision_note) <= 500),

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- A decision must record who made it. Without this a row can quietly become
  -- 'approved' with nobody's name against it, which is the one field an audit
  -- of "who let this person in" actually needs.
  constraint signup_requests_decided_together
    check ((status = 'pending') = (decided_by is null and decided_at is null))
);

-- One live request per identity. A second submission while the first is still
-- pending is a person pressing the button twice, not a second application, and
-- two identical rows in an approval queue is how one of them gets approved
-- twice. Partial, so a rejected applicant may apply again later.
create unique index signup_requests_one_pending
  on signup_requests (lower(trim(user_id))) where status = 'pending';

-- The queue: oldest first, because a request that has waited longest is the one
-- somebody is still waiting on.
create index signup_requests_pending_idx
  on signup_requests (created_at) where status = 'pending';

create trigger signup_requests_touch
  before update on signup_requests
  for each row execute function app.touch_row();

comment on table signup_requests is
  'Requests for a login. Carries no authority: an approved row is a record of a decision, not a credential. Accounts are created by application code after an admin approves.';

-- -----------------------------------------------------------------------------
-- RLS: the owner reads this and nobody else
-- -----------------------------------------------------------------------------
alter table signup_requests enable row level security;
alter table signup_requests force  row level security;

-- Admin only, for both halves. Not `is_staff()`: a request carries a person's
-- name and phone number before anyone has agreed they should be in the system,
-- and deciding who gets in is the same authority as deciding what a weaver is
-- paid. Procurement does not need it to do procurement.
create policy signup_requests_admin_read on signup_requests
  for select to authenticated
  using ((select app.is_admin()));

create policy signup_requests_admin_write on signup_requests
  for all to authenticated
  using      ((select app.is_admin()))
  with check ((select app.is_admin()));

grant select, insert, update on signup_requests to authenticated;
-- Explicitly NOT granted to anon. Public reach is the function below and
-- nothing else.
revoke all on signup_requests from anon;

-- -----------------------------------------------------------------------------
-- The one thing a stranger may do
-- -----------------------------------------------------------------------------
-- SECURITY DEFINER with `set search_path = ''` and fully-qualified names, for
-- the reasons migration 005 established: without the empty search_path anyone
-- able to create objects in an earlier schema could shadow the table this
-- writes to.
--
-- Returns void rather than the inserted row. A stranger learns only that the
-- request was accepted — not its id, and not whether it collided with anything
-- — because the response is the only channel through which this endpoint could
-- be made to answer questions about who already has an account.
create or replace function public.request_signup(
  p_user_id   text,
  p_full_name text,
  p_role      text,
  p_vendor_code text default null,
  p_phone     text default null,
  p_note      text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id text := lower(trim(coalesce(p_user_id, '')));
  v_name    text := trim(coalesce(p_full_name, ''));
begin
  if v_user_id = '' or v_name = '' then
    raise exception 'A name and a user ID are both required.'
      using errcode = 'check_violation';
  end if;

  if p_role not in ('vendor', 'warehouse_manager', 'customer_support', 'procurement_head') then
    raise exception 'That is not a role you can request.'
      using errcode = 'check_violation';
  end if;

  -- Silent on a duplicate, on purpose. Raising "you already applied" or "that
  -- account exists" turns this endpoint into an oracle: submit a thousand
  -- guesses, keep the ones that error, and you have a list of who works here.
  -- The admin sees duplicates in the queue; the stranger sees success either
  -- way.
  insert into public.signup_requests
    (user_id, full_name, requested_role, vendor_code, phone, note)
  values
    (v_user_id, v_name, p_role,
     nullif(upper(trim(coalesce(p_vendor_code, ''))), ''),
     nullif(trim(coalesce(p_phone, '')), ''),
     nullif(trim(coalesce(p_note, '')), ''))
  on conflict do nothing;
end;
$$;

comment on function public.request_signup(text, text, text, text, text, text) is
  'The public signup form. Records an ASKING and creates no account. Deliberately silent about duplicates so it cannot be used to enumerate who already has a login.';

revoke all on function public.request_signup(text, text, text, text, text, text) from public;
grant execute on function public.request_signup(text, text, text, text, text, text)
  to anon, authenticated;

-- -----------------------------------------------------------------------------
-- Recording the decision
-- -----------------------------------------------------------------------------
-- The account itself is created by application code, because creating an
-- auth.users row means calling Supabase Auth and Postgres cannot. This function
-- owns the half that IS expressible here: that only an admin decides, that a
-- decision is recorded against a name, and that a request cannot be decided
-- twice.
create or replace function public.decide_signup_request(
  p_id     uuid,
  p_status text,
  p_note   text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current public.signup_status;
begin
  if not (select app.is_admin()) then
    raise exception 'Only the owner can decide who gets an account.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_status not in ('approved', 'rejected') then
    raise exception 'A decision is approved or rejected.' using errcode = 'check_violation';
  end if;

  select status into v_current from public.signup_requests where id = p_id;
  if v_current is null then
    raise exception 'No such request.' using errcode = 'no_data_found';
  end if;

  -- Deciding twice is how one applicant gets two accounts: the approval action
  -- creates a login, and a second approval of the same row would create another
  -- under the same identity.
  if v_current <> 'pending' then
    raise exception 'That request was already %.', v_current using errcode = 'check_violation';
  end if;

  update public.signup_requests
     set status        = p_status::public.signup_status,
         decided_by    = (select auth.uid()),
         decided_at    = now(),
         decision_note = nullif(trim(coalesce(p_note, '')), '')
   where id = p_id;
end;
$$;

comment on function public.decide_signup_request(uuid, text, text) is
  'Records an admin decision on a signup request. Refuses a request that was already decided, because approving twice would mint two logins for one person.';

revoke all on function public.decide_signup_request(uuid, text, text) from public, anon;
grant execute on function public.decide_signup_request(uuid, text, text) to authenticated;
