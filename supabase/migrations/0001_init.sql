-- ParleyNotes core schema. Source of truth for the domain model mirrored in
-- packages/core/src/domain/entities.ts. Cloud-primary: the device is a cache.
--
-- Entities: profiles, orgs, memberships, meetings, speakers, transcript
-- segments, notes, action items (tasks), integrations, and vector embeddings
-- for semantic search over the org "hive mind".

create extension if not exists "vector";        -- pgvector: semantic search / RAG
create extension if not exists "pgcrypto";       -- gen_random_uuid()

-- ---------- enums ----------
create type org_role             as enum ('admin', 'member');
create type org_plan             as enum ('free', 'team', 'company');
create type meeting_visibility   as enum ('private', 'org');
create type meeting_status       as enum ('scheduled', 'recording', 'processing', 'complete', 'failed');
create type task_status          as enum ('open', 'in_progress', 'done', 'cancelled');
create type integration_provider as enum ('notion', 'google', 'microsoft', 'onenote', 'google_docs');

-- ---------- profiles (1:1 with auth.users) ----------
create table profiles (
  id             uuid primary key references auth.users (id) on delete cascade,
  email          text not null,
  full_name      text,
  avatar_url     text,
  default_org_id uuid,
  created_at     timestamptz not null default now()
);

-- ---------- orgs (business accounts / "company brain") ----------
create table orgs (
  id                         uuid primary key default gen_random_uuid(),
  name                       text not null,
  -- admin-controlled default sharing policy for new meetings
  default_meeting_visibility meeting_visibility not null default 'private',
  plan                       org_plan not null default 'free',
  created_at                 timestamptz not null default now()
);

alter table profiles
  add constraint profiles_default_org_fk
  foreign key (default_org_id) references orgs (id) on delete set null;

-- ---------- memberships ----------
create table org_members (
  org_id     uuid not null references orgs (id) on delete cascade,
  user_id    uuid not null references profiles (id) on delete cascade,
  role       org_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index org_members_user_idx on org_members (user_id);

-- ---------- meetings ----------
create table meetings (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references orgs (id) on delete cascade,
  owner_id          uuid not null references profiles (id) on delete cascade,
  title             text not null default 'Untitled meeting',
  status            meeting_status not null default 'complete',
  visibility        meeting_visibility not null default 'private',
  calendar_event_id text,
  started_at        timestamptz,
  ended_at          timestamptz,
  lang              text not null default 'en',
  created_at        timestamptz not null default now()
);
create index meetings_org_idx   on meetings (org_id, created_at desc);
create index meetings_owner_idx on meetings (owner_id, created_at desc);

-- ---------- speakers (diarization output, with identity likelihood) ----------
create table speakers (
  id                    uuid primary key default gen_random_uuid(),
  meeting_id            uuid not null references meetings (id) on delete cascade,
  label                 text not null,                       -- "Speaker 1"
  identified_profile_id uuid references profiles (id) on delete set null,
  identified_name       text,
  identity_confidence   real,                                -- 0..1 likelihood
  created_at            timestamptz not null default now()
);
create index speakers_meeting_idx on speakers (meeting_id);

-- ---------- transcript segments ----------
create table transcript_segments (
  id         uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references meetings (id) on delete cascade,
  speaker_id uuid references speakers (id) on delete set null,
  start_ms   integer not null,
  end_ms     integer not null,
  text       text not null,
  confidence real,                                           -- 0..1 ASR confidence
  created_at timestamptz not null default now()
);
create index transcript_segments_meeting_idx on transcript_segments (meeting_id, start_ms);

-- ---------- notes ----------
create table meeting_notes (
  meeting_id uuid primary key references meetings (id) on delete cascade,
  summary    text[] not null default '{}',
  decisions  text[] not null default '{}',
  questions  text[] not null default '{}',
  markdown   text not null default '',
  generator  text not null default 'local',
  word_count integer not null default 0,
  updated_at timestamptz not null default now()
);

-- ---------- action items (tasks) ----------
create table action_items (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs (id) on delete cascade,
  meeting_id  uuid references meetings (id) on delete set null,
  title       text not null,
  status      task_status not null default 'open',
  assignee_id uuid references profiles (id) on delete set null,
  due_date    date,
  created_at  timestamptz not null default now()
);
create index action_items_org_idx      on action_items (org_id, status);
create index action_items_assignee_idx on action_items (assignee_id, status);

-- ---------- integrations (secrets stored via Vault, not here) ----------
create table integrations (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references orgs (id) on delete cascade,
  user_id             uuid not null references profiles (id) on delete cascade,
  provider            integration_provider not null,
  external_account_id text,
  config              jsonb not null default '{}',
  connected_at        timestamptz not null default now(),
  unique (user_id, provider)
);
create index integrations_org_idx on integrations (org_id);

-- ---------- embeddings (RAG over the hive mind) ----------
-- Dimension 768 matches nomic-embed-text (runs on-device via llama.cpp). Change
-- this if you swap the embedding model; keep app + DB in lockstep.
create table embeddings (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references orgs (id) on delete cascade,
  meeting_id uuid references meetings (id) on delete cascade,
  content    text not null,
  embedding  vector(768) not null,
  created_at timestamptz not null default now()
);
create index embeddings_ann_idx on embeddings using hnsw (embedding vector_cosine_ops);
create index embeddings_org_idx on embeddings (org_id);
