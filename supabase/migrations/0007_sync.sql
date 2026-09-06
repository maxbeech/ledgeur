-- Sync that is actually sync.
--
-- Before this, a meeting was pushed once, on stop, under a server-generated id
-- the device never learned, and nothing ever updated it: a renamed speaker, an
-- edited title, a meeting filed into a space, notes typed during the meeting —
-- none of it reached the cloud, and a second device saw the transcript as it
-- was the moment it was first pushed. Spaces, recipes and manual notes were not
-- in the database at all.
--
-- What changes:
--   * Devices supply meeting ids (the column already allowed it), so the same
--     meeting has the same id everywhere and an update is an update.
--   * `updated_at` on everything a device can edit. The DEVICE sets it, not a
--     trigger: last-writer-wins only works if every writer uses the same clock
--     for the same row, and the devices are the writers.
--   * Soft deletes (`deleted_at`) so other devices learn a meeting is gone,
--     rather than seeing it reappear from their own cache.
--   * `folders` (spaces) and `note_templates` (recipes) as personal tables.
--   * `manual_notes` on meeting_notes — what the person typed during the
--     meeting, kept verbatim, previously the one thing that never synced.
--   * Realtime on the synced tables, so a second device updates without a
--     refresh.

-- ---------- meetings ----------
alter table meetings add column updated_at  timestamptz not null default now();
alter table meetings add column deleted_at  timestamptz;
alter table meetings add column template_id text;
create index meetings_updated_idx on meetings (org_id, updated_at desc);

-- ---------- spaces ----------
-- Personal: a space is how one person files their own meetings. Sharing a
-- space is a different feature (and a different policy), not this one.
create table folders (
  id         uuid primary key,                       -- device-supplied
  owner_id   uuid not null references profiles (id) on delete cascade,
  name       text not null,
  tone       text not null default 'sky',            -- a pastel family name
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index folders_owner_idx on folders (owner_id, updated_at desc);
alter table folders enable row level security;
create policy "folders: owner all" on folders for all
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

alter table meetings add column folder_id uuid references folders (id) on delete set null;

-- ---------- recipes ----------
create table note_templates (
  owner_id    uuid not null references profiles (id) on delete cascade,
  template_id text not null,                         -- the "custom:…" id the app uses
  name        text not null,
  description text not null default '',
  focus       text not null default '',
  looks_for   text[] not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  primary key (owner_id, template_id)
);
create index note_templates_owner_idx on note_templates (owner_id, updated_at desc);
alter table note_templates enable row level security;
create policy "note_templates: owner all" on note_templates for all
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- ---------- notes ----------
alter table meeting_notes add column manual_notes text not null default '';

-- ---------- tasks ----------
alter table action_items add column updated_at timestamptz not null default now();

-- ---------- realtime ----------
-- Row-level security applies to change events too, so a device only hears
-- about rows it could have read.
alter publication supabase_realtime add table meetings, meeting_notes, action_items, folders, note_templates;
