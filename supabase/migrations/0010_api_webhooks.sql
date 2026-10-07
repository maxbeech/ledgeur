-- Server-side webhooks for the public Meetings API.
--
-- An outside app can subscribe (POST /api/v1/webhooks) and is told when a
-- meeting completes, changes or is deleted. This migration holds the storage
-- and the change capture; the delivery runs in apps/marketing
-- (app/api/cron/webhooks), once a minute.
--
-- ---------- how a change becomes an event ----------
-- Triggers on meetings, speakers, transcript_segments, meeting_notes and
-- action_items write ONE pending row per meeting into `webhook_outbox` and push
-- its due time two minutes into the future every time the meeting is touched.
-- A device sync deletes and reinserts every segment of a meeting, and a
-- transcript is thousands of rows, so the segment triggers are statement-level:
-- one statement is one touch, however many rows it moved. The row only comes
-- due once the meeting has been quiet for two minutes, which is what makes
-- "completed" mean completed rather than "the sync is half way".
--
-- ---------- who can see it ----------
-- Every table here has RLS on and NO policies, like integration_secrets: only
-- the service role (the dispatcher and the API's webhook endpoints, which scope
-- every query to the key's owner) can touch them. The subscription's signing
-- secret lives here, so a client must never be able to select it.
--
-- Every statement is safe to run twice.

-- ---------- subscriptions ----------
create table if not exists webhook_subscriptions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references profiles (id) on delete cascade,
  url              text not null,
  events           text[] not null,
  -- whsec_…; kept in clear because it is the HMAC key we sign with. Returned to
  -- the caller once, when the subscription is created.
  secret           text not null,
  created_at       timestamptz not null default now(),
  last_delivery_at timestamptz,
  last_status      text check (last_status in ('delivered', 'retrying', 'failed')),
  last_status_code integer,
  check (events <@ array['meeting.completed', 'meeting.updated', 'meeting.deleted']::text[] and cardinality(events) > 0)
);
create index if not exists webhook_subscriptions_user_idx on webhook_subscriptions (user_id);
alter table webhook_subscriptions enable row level security;

-- ---------- outbox: one pending row per meeting ----------
-- No foreign key to meetings: a hard-deleted meeting still has to be announced,
-- so the row carries what the dispatcher needs (owner, workspace, visibility, a
-- summary snapshot) rather than reading it back from a row that is gone.
create table if not exists webhook_outbox (
  meeting_id uuid primary key,
  kind       text not null default 'change' check (kind in ('change', 'deleted')),
  due_at     timestamptz not null,
  owner_id   uuid,
  org_id     uuid,
  visibility text,
  snapshot   jsonb,
  created_at timestamptz not null default now()
);
create index if not exists webhook_outbox_due_idx on webhook_outbox (due_at);
alter table webhook_outbox enable row level security;

-- ---------- per-meeting event state ----------
-- Whether `meeting.completed` has already fired for a meeting (it fires once),
-- and whether its deletion has been announced.
create table if not exists webhook_meeting_state (
  meeting_id          uuid primary key,
  completed_at        timestamptz,
  deleted_notified_at timestamptz
);
alter table webhook_meeting_state enable row level security;

-- Meetings that were already complete before webhooks existed have not
-- "just completed": a later edit to one is an update.
insert into webhook_meeting_state (meeting_id, completed_at)
select id, now() from meetings where status = 'complete' and deleted_at is null
on conflict (meeting_id) do nothing;

-- ---------- deliveries ----------
create table if not exists webhook_deliveries (
  id               uuid primary key default gen_random_uuid(),   -- the event id
  subscription_id  uuid not null references webhook_subscriptions (id) on delete cascade,
  event_type       text not null,
  meeting_id       uuid not null,
  payload          jsonb not null,
  status           text not null default 'pending' check (status in ('pending', 'delivered', 'failed')),
  attempts         integer not null default 0,
  next_attempt_at  timestamptz not null default now(),
  last_status_code integer,
  last_error       text,
  created_at       timestamptz not null default now(),
  delivered_at     timestamptz
);
create index if not exists webhook_deliveries_due_idx on webhook_deliveries (next_attempt_at) where status = 'pending';
create index if not exists webhook_deliveries_sub_idx on webhook_deliveries (subscription_id, created_at desc);
alter table webhook_deliveries enable row level security;

-- ---------- capture ----------
-- security definer: the triggers run as whoever wrote the row (a signed-in user
-- under RLS), and that user must not be able to write the outbox directly.
create or replace function public.webhook_enqueue(
  p_meeting uuid, p_kind text, p_owner uuid, p_org uuid, p_visibility text, p_snapshot jsonb
) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into webhook_outbox (meeting_id, kind, due_at, owner_id, org_id, visibility, snapshot)
  values (
    p_meeting, p_kind,
    case when p_kind = 'deleted' then now() else now() + interval '2 minutes' end,
    p_owner, p_org, p_visibility, p_snapshot
  )
  on conflict (meeting_id) do update set
    -- A deletion wins and stays due immediately; a change just moves the window.
    kind     = case when webhook_outbox.kind = 'deleted' or excluded.kind = 'deleted' then 'deleted' else 'change' end,
    due_at   = case when webhook_outbox.kind = 'deleted' then webhook_outbox.due_at
                    when excluded.kind = 'deleted' then now()
                    else excluded.due_at end,
    owner_id = excluded.owner_id,
    org_id = excluded.org_id,
    visibility = excluded.visibility,
    snapshot = coalesce(excluded.snapshot, webhook_outbox.snapshot);
end $$;

create or replace function public.webhook_touch(p_meeting uuid)
returns void language plpgsql security definer set search_path = public as $$
declare m record;
begin
  select owner_id, org_id, visibility, deleted_at into m from meetings where id = p_meeting;
  -- Gone already (a cascade from a hard delete): the delete trigger has it.
  if not found then return; end if;
  perform public.webhook_enqueue(
    p_meeting, case when m.deleted_at is not null then 'deleted' else 'change' end,
    m.owner_id, m.org_id, m.visibility::text, null
  );
end $$;

create or replace function public.webhook_meetings_changed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    perform public.webhook_enqueue(
      old.id, 'deleted', old.owner_id, old.org_id, old.visibility::text,
      jsonb_build_object(
        'id', old.id, 'title', old.title, 'status', old.status, 'started_at', old.started_at,
        'ended_at', old.ended_at, 'lang', old.lang, 'updated_at', old.updated_at,
        'deleted_at', coalesce(old.deleted_at, now())
      )
    );
    return old;
  end if;
  perform public.webhook_enqueue(
    new.id, case when new.deleted_at is not null then 'deleted' else 'change' end,
    new.owner_id, new.org_id, new.visibility::text, null
  );
  return new;
end $$;

-- Statement-level, over the transition table: a sync that rewrites a whole
-- transcript is one touch per meeting, not one per row.
create or replace function public.webhook_children_changed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.webhook_touch(t.meeting_id)
  from (select distinct meeting_id from changed_rows where meeting_id is not null) t;
  return null;
end $$;

revoke all on function public.webhook_enqueue(uuid, text, uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.webhook_touch(uuid) from public, anon, authenticated;

drop trigger if exists webhook_meetings_ins on meetings;
create trigger webhook_meetings_ins after insert on meetings
  for each row execute function public.webhook_meetings_changed();
drop trigger if exists webhook_meetings_upd on meetings;
create trigger webhook_meetings_upd after update on meetings
  for each row when (old.* is distinct from new.*) execute function public.webhook_meetings_changed();
drop trigger if exists webhook_meetings_del on meetings;
create trigger webhook_meetings_del after delete on meetings
  for each row execute function public.webhook_meetings_changed();

do $$
declare t text;
begin
  foreach t in array array['transcript_segments', 'speakers', 'meeting_notes', 'action_items'] loop
    execute format('drop trigger if exists webhook_%1$s_ins on public.%1$I', t);
    execute format('drop trigger if exists webhook_%1$s_upd on public.%1$I', t);
    execute format('drop trigger if exists webhook_%1$s_del on public.%1$I', t);
    execute format('create trigger webhook_%1$s_ins after insert on public.%1$I referencing new table as changed_rows for each statement execute function public.webhook_children_changed()', t);
    execute format('create trigger webhook_%1$s_upd after update on public.%1$I referencing new table as changed_rows for each statement execute function public.webhook_children_changed()', t);
    execute format('create trigger webhook_%1$s_del after delete on public.%1$I referencing old table as changed_rows for each statement execute function public.webhook_children_changed()', t);
  end loop;
end $$;

-- ---------- claiming work (service role only) ----------
-- `skip locked` lets two dispatchers (the schedule plus an overlapping run)
-- share the queue without taking the same row twice.
create or replace function public.webhook_claim_outbox(p_limit integer default 200)
returns setof webhook_outbox language plpgsql security definer set search_path = public as $$
begin
  return query
  delete from webhook_outbox where meeting_id in (
    select meeting_id from webhook_outbox where due_at <= now()
    order by due_at limit p_limit for update skip locked
  ) returning *;
end $$;

-- A claimed delivery is leased for ten minutes: if the dispatcher dies mid
-- attempt, the delivery simply comes due again.
create or replace function public.webhook_claim_deliveries(p_limit integer default 100)
returns setof webhook_deliveries language plpgsql security definer set search_path = public as $$
begin
  return query
  update webhook_deliveries set next_attempt_at = now() + interval '10 minutes' where id in (
    select id from webhook_deliveries where status = 'pending' and next_attempt_at <= now()
    order by next_attempt_at limit p_limit for update skip locked
  ) returning *;
end $$;

revoke all on function public.webhook_claim_outbox(integer) from public, anon, authenticated;
revoke all on function public.webhook_claim_deliveries(integer) from public, anon, authenticated;
grant execute on function public.webhook_claim_outbox(integer) to service_role;
grant execute on function public.webhook_claim_deliveries(integer) to service_role;
