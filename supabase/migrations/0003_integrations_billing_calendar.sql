-- Phase 1+ tables: secure integration secrets, plan-gated MCP access tokens, and
-- cached calendar events for the meeting auto-prompt.

-- ---------- integration secrets (service-role only; never exposed via RLS) ----------
-- Holds OAuth access/refresh tokens for connected providers. RLS is enabled with
-- NO policies, so only the service role (edge functions) can read/write — the
-- client never sees raw provider tokens.
create table integration_secrets (
  integration_id uuid primary key references integrations (id) on delete cascade,
  access_token   text not null,
  refresh_token  text,
  expires_at     timestamptz,
  updated_at     timestamptz not null default now()
);
alter table integration_secrets enable row level security;
-- (intentionally no policies)

-- ---------- MCP access tokens (the paid data tier) ----------
create table mcp_tokens (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles (id) on delete cascade,
  org_id     uuid not null references orgs (id) on delete cascade,
  -- sha-256 of the issued token; the plaintext is shown once and never stored.
  token_hash text not null unique,
  name       text not null default 'MCP token',
  last_used_at timestamptz,
  revoked    boolean not null default false,
  created_at timestamptz not null default now()
);
create index mcp_tokens_user_idx on mcp_tokens (user_id) where not revoked;
alter table mcp_tokens enable row level security;
-- Users can see/revoke their own token metadata (never the hash-source plaintext).
create policy "mcp_tokens: owner read"   on mcp_tokens for select using (user_id = auth.uid());
create policy "mcp_tokens: owner revoke" on mcp_tokens for update using (user_id = auth.uid());

-- ---------- cached calendar events (for the auto-prompt) ----------
create table calendar_events (
  id          text not null,                    -- provider event id
  user_id     uuid not null references profiles (id) on delete cascade,
  provider    integration_provider not null,
  title       text not null default '(no title)',
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  is_online   boolean not null default false,
  meeting_url text,
  updated_at  timestamptz not null default now(),
  primary key (user_id, id)
);
create index calendar_events_user_time_idx on calendar_events (user_id, starts_at);
alter table calendar_events enable row level security;
create policy "calendar: owner all" on calendar_events for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- helper: is the caller's org on a paid plan? (gates MCP token mint) ----------
create or replace function public.org_is_paid(p_org uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from orgs where id = p_org and plan in ('team', 'company'));
$$;
