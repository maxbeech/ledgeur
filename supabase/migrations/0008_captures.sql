-- Captures: the thought somebody had between two meetings.
--
-- Until now the only way anything got into Ledgeur was to record a meeting.
-- Tasks existed but could only be *derived* — `action_items` has always allowed
-- a null `meeting_id`, and nothing ever inserted one — and there was nowhere at
-- all to put a note that was not attached to a recording. So the thought you
-- have walking out of a call went where it always goes: nowhere.
--
-- One table holds both kinds. A task and a note are the same row with a
-- different `kind`, because the commonest correction anybody makes is "no,
-- that's a task", and across two tables that tap would be a delete and an
-- insert, with two ids and a window where the thought is in neither.
--
-- ---------- what this is NOT ----------
-- Not a second home for meeting action items. Those stay in `action_items`,
-- derived from the meeting's notes. The Tasks screen lists both; that is a
-- question of what a screen shows, not of where a thought lives.
--
-- ---------- personal, deliberately ----------
-- A capture is somebody's own thinking ("chase Priya", "idea: name a voice from
-- the library"), so the policy is owner-only, exactly like `folders`. A capture
-- filed into a space does not become visible to anyone the space is visible to.
-- Sharing a thought should be a thing a person does on purpose, and it is not
-- this migration.
--
-- Every statement is safe to run twice: these are applied by hand, and a
-- half-applied migration must not be a dead end.

create table if not exists captures (
  id                uuid primary key,                       -- device-supplied
  owner_id          uuid not null references profiles (id) on delete cascade,
  -- The workspace it was made in, for a future shared view. Nullable because a
  -- capture is made and kept long before an account has resolved an org, and
  -- losing the thought over that would be absurd.
  org_id            uuid references orgs (id) on delete set null,
  -- Exactly what was typed, or what the speech model heard. Never rewritten.
  body              text not null,
  -- The short label shown in lists: the model's tidied version when it used only
  -- the person's own words, otherwise a copy of `body`.
  title             text not null default '',
  kind              text not null default 'note' check (kind in ('task', 'note')),
  folder_id         uuid references folders (id) on delete set null,
  -- 'user' once a person has decided; 'inferred' while it is still a guess. A
  -- person's decision is never re-guessed, which is why this is stored rather
  -- than derived from whether a confidence is present.
  kind_source       text not null default 'inferred' check (kind_source in ('inferred', 'user')),
  space_source      text not null default 'inferred' check (space_source in ('inferred', 'user')),
  kind_confidence   real not null default 0,
  space_confidence  real not null default 0,
  -- The words from the capture that made the model file it where it did. Shown
  -- in the UI, so "why is this in Acme?" is answerable without asking again.
  space_evidence    text not null default '',
  entry             text not null default 'typed' check (entry in ('typed', 'spoken')),
  done              boolean not null default false,
  -- Set when no model could be asked. The capture is kept and sits in the inbox;
  -- this is why, so the UI can offer to sort it rather than looking forgetful.
  unsorted_reason   text not null default '',
  created_at        timestamptz not null default now(),
  -- The DEVICE sets this, not a trigger: last-writer-wins only works when every
  -- writer of a row uses the same clock, and the devices are the writers.
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz
);

create index if not exists captures_owner_idx  on captures (owner_id, updated_at desc);
create index if not exists captures_folder_idx on captures (folder_id) where deleted_at is null;

alter table captures enable row level security;
drop policy if exists "captures: owner all" on captures;
create policy "captures: owner all" on captures for all
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- ---------- realtime ----------
-- A thought captured on the phone should be on the laptop by the time you get
-- back to it. RLS applies to change events too, so a device only hears about
-- rows it could have read.
--
-- `alter publication … add table` has no IF NOT EXISTS and errors once a table
-- is already published, so it is added only when missing.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'captures'
  ) then
    execute 'alter publication supabase_realtime add table public.captures';
  end if;
end $$;
