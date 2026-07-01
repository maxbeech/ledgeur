import { useEffect, useState } from "react";
import { Users } from "lucide-react";
import type { Session } from "@supabase/supabase-js";
import { Card, Toggle, Spinner } from "../ui.tsx";
import { getSupabase } from "../../lib/supabase.ts";
import { hasBackend } from "../../lib/config.ts";

// Admin default-sharing policy — backed by orgs.default_meeting_visibility (real
// column, enforced by RLS). New meetings join the org "hive mind" when on.
export function SharingPolicyCard({ session }: { session: Session | null }) {
  const [visibility, setVisibility] = useState<"private" | "org" | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!session) { setVisibility(null); return; }
    const sb = getSupabase();
    if (!sb) return;
    (async () => {
      const { data: org } = await sb.from("orgs").select("id, default_meeting_visibility").limit(1).maybeSingle();
      const { data: member } = await sb.from("org_members").select("role").eq("user_id", session.user.id).limit(1).maybeSingle();
      if (org) { setOrgId(org.id); setVisibility(org.default_meeting_visibility === "org" ? "org" : "private"); }
      setIsAdmin(member?.role === "admin");
    })().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [session]);

  async function toggle(on: boolean) {
    const sb = getSupabase();
    if (!sb || !orgId) return;
    const next = on ? "org" : "private";
    setSaving(true); setError("");
    const prev = visibility;
    setVisibility(next); // optimistic
    const { error: e } = await sb.from("orgs").update({ default_meeting_visibility: next }).eq("id", orgId);
    if (e) { setVisibility(prev ?? "private"); setError(e.message); }
    setSaving(false);
  }

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <Users className="mt-0.5 h-5 w-5 text-accent-strong" />
          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-ink-text">
              Share new meetings with the team by default {saving && <Spinner className="h-3.5 w-3.5" />}
            </div>
            <p className="mt-0.5 max-w-md text-xs leading-relaxed text-muted">
              When on, new meeting notes join the org "hive mind" so colleagues' AI can reference them. Members can still mark individual meetings private.
              {!hasBackend && " Configure the backend to enable."}
              {hasBackend && session && !isAdmin && " Only an org admin can change this."}
              {hasBackend && !session && " Sign in as an admin to change this."}
            </p>
            {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
          </div>
        </div>
        <Toggle on={visibility === "org"} onChange={toggle} disabled={!hasBackend || !session || !isAdmin || saving} />
      </div>
    </Card>
  );
}
