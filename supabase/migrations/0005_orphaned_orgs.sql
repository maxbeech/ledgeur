-- Deleting a user left their workspace behind.
--
-- `org_members` cascades from `profiles`, so removing a user removes their
-- membership — but `orgs` has no owner column and nothing pointed at it, so the
-- workspace row survived with nobody in it. Nobody could reach it either: every
-- policy on `orgs` and on everything scoped to an org requires membership, so an
-- org with no members is unreachable by definition. It was simply litter.
--
-- It also quietly contradicted the privacy notice, which says data is removed
-- within 30 days of closing an account. A row that survives account deletion
-- forever is not that, even if it only holds a workspace name.
--
-- Found by deleting the test accounts used to verify the paid path end to end
-- and noticing three workspaces still standing afterwards.

create or replace function public.delete_org_when_last_member_leaves()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Only when the last one goes. Deleting the org cascades back to
  -- `org_members`, but by then there are no rows left to re-fire this.
  if not exists (select 1 from org_members where org_id = old.org_id) then
    delete from orgs where id = old.org_id;
  end if;
  return old;
end;
$$;

drop trigger if exists on_org_member_removed on org_members;
create trigger on_org_member_removed
  after delete on org_members
  for each row execute function public.delete_org_when_last_member_leaves();

-- Clear out anything already orphaned. Meetings, notes, segments, tasks and
-- embeddings all cascade from `orgs`, so this is complete rather than partial.
delete from orgs o where not exists (select 1 from org_members m where m.org_id = o.id);
