-- =============================================================================
-- M1 / 003 — Audit log and transactional outbox
-- =============================================================================
-- Two pieces of infrastructure that must exist before any business table, and
-- are extremely painful to retrofit.
--
-- AUDIT: trigger-driven, not application-driven. Application-level audit
-- logging is always correct until the one code path where someone forgot it —
-- and that is invariably the path under dispute. A trigger cannot be forgotten.
--
-- OUTBOX: n8n must never be the source of truth (see plan). The outbox pattern
-- writes the intent-to-notify in the SAME transaction as the state change. If
-- the transaction rolls back, no notification. If it commits, the notification
-- is guaranteed to be delivered at least once, and the idempotency key makes
-- redelivery harmless. Calling an n8n webhook directly from application code
-- gives neither guarantee.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- audit_log
-- -----------------------------------------------------------------------------
create table audit_log (
  id           bigserial   primary key,
  occurred_at  timestamptz not null default now(),
  table_name   text        not null,
  record_id    uuid,
  action       audit_action not null,
  -- Nullable: system/migration writes have no authenticated actor.
  actor_id     uuid        references app_users (id),
  actor_role   app_role,
  -- Denormalised so the trail survives even if the vendor row is later archived.
  vendor_id    uuid,
  old_data     jsonb,
  new_data     jsonb,
  -- Only the keys that actually changed. Makes "what did they edit?" a cheap
  -- query instead of a client-side diff across two large JSONB blobs.
  changed_keys text[],
  request_id   text
);

create index audit_log_record_idx   on audit_log (table_name, record_id, occurred_at desc);
create index audit_log_actor_idx    on audit_log (actor_id, occurred_at desc);
create index audit_log_vendor_idx   on audit_log (vendor_id, occurred_at desc) where vendor_id is not null;
create index audit_log_occurred_idx on audit_log (occurred_at desc);

-- Append-only, enforced by the database. No UPDATE, no DELETE, ever — including
-- by the service role. An audit log that privileged code can rewrite is not an
-- audit log.
create or replace function app.audit_log_is_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_log is append-only; % is not permitted', tg_op
    using errcode = 'restrict_violation';
end;
$$;

create trigger audit_log_no_update
  before update or delete on audit_log
  for each row execute function app.audit_log_is_append_only();

comment on table audit_log is
  'Append-only change history. Written by trigger on every mutable table. No UPDATE or DELETE permitted, even by service_role.';

-- -----------------------------------------------------------------------------
-- The generic audit trigger
-- -----------------------------------------------------------------------------
-- Attached to every mutable business table via app.enable_audit('table_name').
--
-- Resolving the actor: auth.uid() is the authenticated user. It is NULL for
-- service-role writes (integrations, migrations, n8n), which is recorded
-- honestly as a NULL actor rather than being attributed to someone.
create or replace function app.audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = app, public, pg_catalog
as $$
declare
  v_old        jsonb;
  v_new        jsonb;
  v_actor      uuid := auth.uid();
  v_role       app_role;
  v_vendor_id  uuid;
  v_record_id  uuid;
  v_changed    text[];
  v_request_id text;
begin
  v_old := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;

  -- Redact secrets before they reach the trail. Bank account numbers are the
  -- obvious case: the audit log has a wider read audience than the vendor
  -- record itself, and "who changed the bank account" is the question that
  -- matters, not "what was it changed to".
  if v_old ? 'account_number' then
    v_old := jsonb_set(v_old, '{account_number}', '"[redacted]"');
  end if;
  if v_new ? 'account_number' then
    v_new := jsonb_set(v_new, '{account_number}', '"[redacted]"');
  end if;

  v_record_id := nullif(coalesce(v_new ->> 'id', v_old ->> 'id'), '')::uuid;
  v_vendor_id := nullif(coalesce(v_new ->> 'vendor_id', v_old ->> 'vendor_id'), '')::uuid;

  -- The vendors table is itself vendor-scoped: its own id IS the vendor id.
  if tg_table_name = 'vendors' then
    v_vendor_id := v_record_id;
  end if;

  if tg_op = 'UPDATE' then
    select array_agg(key order by key)
      into v_changed
      from jsonb_each(v_new)
     where v_old -> key is distinct from v_new -> key
       -- Bookkeeping columns are noise; they change on every single update.
       and key not in ('updated_at', 'version');

    -- Nothing of substance changed: skip the row entirely rather than filling
    -- the trail with empty diffs.
    if v_changed is null or cardinality(v_changed) = 0 then
      return null;
    end if;
  end if;

  if v_actor is not null then
    select role into v_role from app_users where id = v_actor;
  end if;

  -- Set by the application layer per request (see src/lib/supabase/server.ts)
  -- so a database change can be traced back to an HTTP request and a log line.
  v_request_id := nullif(current_setting('app.request_id', true), '');

  insert into audit_log (
    table_name, record_id, action, actor_id, actor_role,
    vendor_id, old_data, new_data, changed_keys, request_id
  ) values (
    tg_table_name, v_record_id, lower(tg_op)::audit_action, v_actor, v_role,
    v_vendor_id, v_old, v_new, v_changed, v_request_id
  );

  return null;  -- AFTER trigger; return value is ignored
end;
$$;

-- Convenience installer so later migrations cannot get the wiring subtly wrong.
create or replace function app.enable_audit(p_table text)
returns void
language plpgsql
as $$
begin
  execute format(
    'create trigger %I after insert or update or delete on %I
       for each row execute function app.audit_trigger()',
    p_table || '_audit', p_table
  );
end;
$$;

select app.enable_audit('app_users');
select app.enable_audit('vendors');
select app.enable_audit('vendor_users');

-- -----------------------------------------------------------------------------
-- events — transactional outbox
-- -----------------------------------------------------------------------------
-- Written in the same transaction as the state change that caused it. n8n polls
-- for unprocessed rows, performs the side effect (SMS, email, ERP push), and
-- marks the row processed.
create table events (
  id               uuid        primary key default gen_random_uuid(),
  topic            text        not null check (topic ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  payload          jsonb       not null default '{}'::jsonb,
  -- Denormalised for cheap filtering and for vendor-scoped RLS if we ever
  -- expose an event feed to vendors.
  vendor_id        uuid        references vendors (id),
  aggregate_type   text,
  aggregate_id     uuid,

  occurred_at      timestamptz not null default now(),
  -- Deferred delivery: "chase this PO if unacknowledged in 48h" is just an
  -- event with available_at in the future. Avoids a separate scheduler.
  available_at     timestamptz not null default now(),
  processed_at     timestamptz,
  attempts         integer     not null default 0,
  last_error       text,
  -- Consumer-supplied dedupe key. Guarantees at-most-once side effects even
  -- though delivery is at-least-once.
  idempotency_key  text,

  constraint events_processed_needs_time
    check ((processed_at is null) or (processed_at >= occurred_at))
);

create unique index events_idempotency_uniq
  on events (idempotency_key) where idempotency_key is not null;

-- The consumer's hot query: unprocessed, due, oldest first. Partial index keeps
-- it small — processed rows fall out of the index entirely.
create index events_pending_idx
  on events (available_at, occurred_at)
  where processed_at is null;

create index events_topic_idx     on events (topic, occurred_at desc);
create index events_aggregate_idx on events (aggregate_type, aggregate_id, occurred_at desc);

comment on table events is
  'Transactional outbox. Written in-transaction with the state change; drained by n8n. n8n performs effects only and never holds state.';
comment on column events.available_at is
  'Earliest delivery time. Future values implement deferred reminders (e.g. unacknowledged-PO chase) without a separate scheduler.';

-- Helper used by business logic to emit an event. Keeping it a function means
-- the topic naming convention and payload shape are enforced in one place.
create or replace function app.emit_event(
  p_topic           text,
  p_payload         jsonb   default '{}'::jsonb,
  p_vendor_id       uuid    default null,
  p_aggregate_type  text    default null,
  p_aggregate_id    uuid    default null,
  p_available_at    timestamptz default null,
  p_idempotency_key text    default null
)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  insert into events (
    topic, payload, vendor_id, aggregate_type, aggregate_id,
    available_at, idempotency_key
  ) values (
    p_topic, coalesce(p_payload, '{}'::jsonb), p_vendor_id, p_aggregate_type, p_aggregate_id,
    coalesce(p_available_at, now()), p_idempotency_key
  )
  -- The index predicate must be restated: events_idempotency_uniq is PARTIAL
  -- (`where idempotency_key is not null`), and Postgres will not match a
  -- partial index for conflict arbitration unless the inference clause repeats
  -- its predicate. Omitting it raises "no unique or exclusion constraint
  -- matching the ON CONFLICT specification" on every single emit.
  on conflict (idempotency_key) where idempotency_key is not null do nothing
  returning id into v_id;

  -- NULL when a duplicate idempotency key suppressed the insert. Callers that
  -- care can distinguish "emitted" from "already emitted"; most do not.
  return v_id;
end;
$$;
