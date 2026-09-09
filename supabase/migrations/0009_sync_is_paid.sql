-- Sync is a paid feature. Until this migration, it was not one.
--
-- ---------- the leak ----------
-- /pricing has always sold cross-device sync, the shared team library and the
-- agent endpoint as the Team tier, and the MCP endpoint really was gated
-- (`org_is_paid`, migration 0003). Sync was not. Every signed-in account pushed
-- and pulled regardless of plan, which docs/REDESIGN.md recorded as an
-- assumption rather than a bug and which nobody had gone back to close. So the
-- headline paid feature was free to anyone who made an account, and the price
-- list described a business the database was not running.
--
-- ---------- what is gated, and what deliberately is not ----------
-- INSERT and UPDATE on the synced tables now require a paid plan. That is the
-- whole gate, and it is the only defensible one:
--
--   SELECT is untouched. Somebody who cancels can still read and pull down
--   everything they uploaded while paying. /pricing says "cancelling stops the
--   sync; it does not take your library away", and a gate on reads would make
--   that sentence a lie.
--
--   DELETE is untouched. Refusing to let a former customer remove their own
--   rows from our database would be indefensible, and probably unlawful.
--
--   Voice prints and the copilot thread are not here because they have never
--   synced at all, on any plan.
--
-- The free plan therefore keeps exactly what /pricing promises it: the entire
-- product, on one device, with the record on that device.
--
-- ---------- why it is enforced here and not in the app ----------
-- A client-side check is a suggestion. The app also gets one (the Settings sync
-- card says plainly that sync is part of the Team plan, rather than letting
-- every push fail with a policy error), but the app is shipped as MIT source
-- and anybody can delete a line from it. The database is where the answer has
-- to be true.
--
-- ---------- safe to run twice ----------
-- Migrations here are applied by hand against a live project, so every
-- statement is idempotent and a half-applied run is not a dead end.

-- ---------- helpers ----------

-- Org-scoped tables ask about their own org. `org_is_paid` already exists from
-- 0003; this restates it so a project that somehow lacks it still gets one, and
-- so that the definition is next to the policies that depend on it.
create or replace function public.org_is_paid(p_org uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from orgs where id = p_org and plan in ('team', 'company'));
$$;

-- Owner-scoped tables (folders, note_templates, captures) carry no org column:
-- they are personal, and a person's plan is whichever of their orgs is paying.
-- One paid membership is enough, which is the generous reading and the right
-- one: somebody whose company pays for Ledgeur should not find their own spaces
-- refused because their personal org is free.
create or replace function public.caller_can_sync()
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1
    from org_members m
    join orgs o on o.id = m.org_id
    where m.user_id = auth.uid() and o.plan in ('team', 'company')
  );
$$;

grant execute on function public.caller_can_sync() to authenticated;

-- ---------- meetings and their children ----------

drop policy if exists "meetings: owner insert" on meetings;
create policy "meetings: owner insert" on meetings for insert with check (
  owner_id = auth.uid() and public.is_org_member(org_id) and public.org_is_paid(org_id)
);

-- An admin editing a shared meeting is still a write to the cloud copy, so the
-- plan check applies to them too. `using` decides which rows are visible to the
-- statement; `with check` decides what the row may become. Both are needed: a
-- `using`-only gate would let a free account read a row for update and then be
-- refused confusingly at write time.
drop policy if exists "meetings: owner or admin update" on meetings;
create policy "meetings: owner or admin update" on meetings for update
  using ((owner_id = auth.uid() or public.is_org_admin(org_id)) and public.org_is_paid(org_id))
  with check (public.org_is_paid(org_id));

-- Speakers, segments and notes were one `for all` policy each, which covered
-- select as well as write. Splitting them is the only way to gate the write
-- half while leaving reading alone.
drop policy if exists "speakers: write" on speakers;
create policy "speakers: write" on speakers for insert
  with check (public.owns_meeting(meeting_id) and public.caller_can_sync());
create policy "speakers: change" on speakers for update
  using (public.owns_meeting(meeting_id) and public.caller_can_sync())
  with check (public.owns_meeting(meeting_id));
create policy "speakers: remove" on speakers for delete using (public.owns_meeting(meeting_id));

drop policy if exists "segments: write" on transcript_segments;
create policy "segments: write" on transcript_segments for insert
  with check (public.owns_meeting(meeting_id) and public.caller_can_sync());
create policy "segments: change" on transcript_segments for update
  using (public.owns_meeting(meeting_id) and public.caller_can_sync())
  with check (public.owns_meeting(meeting_id));
create policy "segments: remove" on transcript_segments for delete using (public.owns_meeting(meeting_id));

drop policy if exists "notes: write" on meeting_notes;
create policy "notes: write" on meeting_notes for insert
  with check (public.owns_meeting(meeting_id) and public.caller_can_sync());
create policy "notes: change" on meeting_notes for update
  using (public.owns_meeting(meeting_id) and public.caller_can_sync())
  with check (public.owns_meeting(meeting_id));
create policy "notes: remove" on meeting_notes for delete using (public.owns_meeting(meeting_id));

-- ---------- action items ----------

drop policy if exists "tasks: org write" on action_items;
create policy "tasks: org write" on action_items for insert
  with check (public.is_org_member(org_id) and public.org_is_paid(org_id));

drop policy if exists "tasks: org update" on action_items;
create policy "tasks: org update" on action_items for update
  using (public.is_org_member(org_id) and public.org_is_paid(org_id))
  with check (public.is_org_member(org_id));

-- ---------- spaces, recipes, captures (owner-scoped) ----------
-- Each was one `for all` policy. Same split: reading and deleting stay open,
-- writing needs a plan.

drop policy if exists "folders: owner all" on folders;
create policy "folders: owner read"   on folders for select using (owner_id = auth.uid());
create policy "folders: owner write"  on folders for insert with check (owner_id = auth.uid() and public.caller_can_sync());
create policy "folders: owner change" on folders for update
  using (owner_id = auth.uid() and public.caller_can_sync()) with check (owner_id = auth.uid());
create policy "folders: owner remove" on folders for delete using (owner_id = auth.uid());

drop policy if exists "templates: owner all" on note_templates;
drop policy if exists "note_templates: owner all" on note_templates;
create policy "templates: owner read"   on note_templates for select using (owner_id = auth.uid());
create policy "templates: owner write"  on note_templates for insert with check (owner_id = auth.uid() and public.caller_can_sync());
create policy "templates: owner change" on note_templates for update
  using (owner_id = auth.uid() and public.caller_can_sync()) with check (owner_id = auth.uid());
create policy "templates: owner remove" on note_templates for delete using (owner_id = auth.uid());

drop policy if exists "captures: owner all" on captures;
create policy "captures: owner read"   on captures for select using (owner_id = auth.uid());
create policy "captures: owner write"  on captures for insert with check (owner_id = auth.uid() and public.caller_can_sync());
create policy "captures: owner change" on captures for update
  using (owner_id = auth.uid() and public.caller_can_sync()) with check (owner_id = auth.uid());
create policy "captures: owner remove" on captures for delete using (owner_id = auth.uid());

-- ---------- embeddings ----------
-- The hive mind's index. Writing one is part of syncing a meeting, so it goes
-- with the meeting.

drop policy if exists "embeddings: owner write" on embeddings;
create policy "embeddings: owner write" on embeddings for insert with check (
  public.is_org_member(org_id)
  and (meeting_id is null or public.owns_meeting(meeting_id))
  and public.org_is_paid(org_id)
);
