-- Row-level security for ParleyNotes. The default deny + explicit policies below
-- enforce: you see your own data, plus org-shared meetings (the "hive mind")
-- when your admin has enabled sharing. Helper functions are SECURITY DEFINER to
-- avoid recursive RLS evaluation.

-- ---------- helper functions ----------
create or replace function public.is_org_member(p_org uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from org_members where org_id = p_org and user_id = auth.uid());
$$;

create or replace function public.is_org_admin(p_org uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from org_members where org_id = p_org and user_id = auth.uid() and role = 'admin');
$$;

create or replace function public.can_view_meeting(p_meeting uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from meetings m
    where m.id = p_meeting
      and (m.owner_id = auth.uid()
           or (m.visibility = 'org' and public.is_org_member(m.org_id)))
  );
$$;

create or replace function public.owns_meeting(p_meeting uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from meetings m where m.id = p_meeting and m.owner_id = auth.uid());
$$;

create or replace function public.org_has_members(p_org uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from org_members where org_id = p_org);
$$;

-- ---------- create a profile + personal workspace on signup ----------
-- Every new user gets a profile, a personal org, and an admin membership so the
-- cloud features (sync, hive mind, MCP, integrations) work immediately. Runs as
-- SECURITY DEFINER, so it bypasses RLS for this one-time bootstrap.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  new_org uuid;
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (new.id, new.email,
          new.raw_user_meta_data ->> 'full_name',
          new.raw_user_meta_data ->> 'avatar_url')
  on conflict (id) do nothing;

  -- Bootstrap a personal workspace once (idempotent: only if they have no org yet).
  if not exists (select 1 from public.org_members where user_id = new.id) then
    insert into public.orgs (name)
    values (coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1)) || '''s workspace')
    returning id into new_org;
    insert into public.org_members (org_id, user_id, role) values (new_org, new.id, 'admin');
    update public.profiles set default_org_id = new_org where id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- enable RLS ----------
alter table profiles            enable row level security;
alter table orgs                enable row level security;
alter table org_members         enable row level security;
alter table meetings            enable row level security;
alter table speakers            enable row level security;
alter table transcript_segments enable row level security;
alter table meeting_notes       enable row level security;
alter table action_items        enable row level security;
alter table integrations        enable row level security;
alter table embeddings          enable row level security;

-- ---------- profiles ----------
create policy "profiles: read self or co-member" on profiles for select using (
  id = auth.uid()
  or exists (
    select 1 from org_members a
    join org_members b on a.org_id = b.org_id
    where a.user_id = auth.uid() and b.user_id = profiles.id
  )
);
create policy "profiles: update self" on profiles for update using (id = auth.uid());

-- ---------- orgs ----------
create policy "orgs: members read"   on orgs for select using (public.is_org_member(id));
create policy "orgs: anyone create"  on orgs for insert with check (auth.uid() is not null);
create policy "orgs: admins update"  on orgs for update using (public.is_org_admin(id));

-- ---------- org_members ----------
create policy "members: read same org" on org_members for select using (public.is_org_member(org_id));
-- A user may add themselves ONLY as the first member of an empty org (bootstrapping
-- their own workspace); otherwise members can only be added by an org admin. This
-- prevents joining an arbitrary populated org to read its shared meetings.
create policy "members: self join" on org_members for insert with check (
  public.is_org_admin(org_id)
  or (user_id = auth.uid() and not public.org_has_members(org_id))
);
create policy "members: admins manage" on org_members for update using (public.is_org_admin(org_id));
create policy "members: admins remove" on org_members for delete using (public.is_org_admin(org_id) or user_id = auth.uid());

-- ---------- meetings ----------
create policy "meetings: view own or org-shared" on meetings for select using (
  owner_id = auth.uid() or (visibility = 'org' and public.is_org_member(org_id))
);
create policy "meetings: owner insert" on meetings for insert with check (
  owner_id = auth.uid() and public.is_org_member(org_id)
);
create policy "meetings: owner or admin update" on meetings for update using (
  owner_id = auth.uid() or public.is_org_admin(org_id)
);
create policy "meetings: owner or admin delete" on meetings for delete using (
  owner_id = auth.uid() or public.is_org_admin(org_id)
);

-- ---------- child rows (speakers / segments / notes) follow the meeting ----------
create policy "speakers: view"  on speakers for select using (public.can_view_meeting(meeting_id));
create policy "speakers: write" on speakers for all using (public.owns_meeting(meeting_id)) with check (public.owns_meeting(meeting_id));

create policy "segments: view"  on transcript_segments for select using (public.can_view_meeting(meeting_id));
create policy "segments: write" on transcript_segments for all using (public.owns_meeting(meeting_id)) with check (public.owns_meeting(meeting_id));

create policy "notes: view"  on meeting_notes for select using (public.can_view_meeting(meeting_id));
create policy "notes: write" on meeting_notes for all using (public.owns_meeting(meeting_id)) with check (public.owns_meeting(meeting_id));

-- ---------- action items (org-scoped tasks) ----------
create policy "tasks: org read"   on action_items for select using (public.is_org_member(org_id) or assignee_id = auth.uid());
create policy "tasks: org write"  on action_items for insert with check (public.is_org_member(org_id));
create policy "tasks: org update" on action_items for update using (public.is_org_member(org_id));
create policy "tasks: org delete" on action_items for delete using (public.is_org_member(org_id));

-- ---------- integrations (strictly personal) ----------
create policy "integrations: owner all" on integrations for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- embeddings (org-scoped; RAG goes through match_embeddings) ----------
-- Mirror the match_embeddings RPC's visibility check on direct SELECTs too, so a
-- member can't read private meetings' transcript chunks via the REST endpoint.
create policy "embeddings: org read"  on embeddings for select using (
  public.is_org_member(org_id) and (meeting_id is null or public.can_view_meeting(meeting_id))
);
create policy "embeddings: owner write" on embeddings for insert with check (
  public.is_org_member(org_id) and (meeting_id is null or public.owns_meeting(meeting_id))
);

-- ---------- semantic search RPC (respects membership + visibility) ----------
create or replace function public.match_embeddings(
  p_org uuid, query vector(768), match_count int default 8
) returns table (content text, meeting_id uuid, similarity real)
language sql stable security definer set search_path = public as $$
  select e.content, e.meeting_id, (1 - (e.embedding <=> query))::real as similarity
  from embeddings e
  where e.org_id = p_org
    and public.is_org_member(p_org)
    and (e.meeting_id is null or public.can_view_meeting(e.meeting_id))
  order by e.embedding <=> query
  limit match_count;
$$;
