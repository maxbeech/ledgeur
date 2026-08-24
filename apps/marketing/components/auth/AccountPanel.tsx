"use client";

// The account page: which plan you are on, how to change it, and the agent
// access tokens.
//
// Everything here shows real state read from the database. There is no
// optimistic "Pro ✨" badge — if the webhook has not landed yet the page says
// the plan is still free, because a page that lies about what you bought is
// worse than one that is briefly behind.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  issueAccessToken, listAccessTokens, revokeAccessToken,
  hostedClientConfig, stdioClientConfig, hostedEndpoint,
  type AccessTokenMeta,
} from "@ledgeur/mcp";
import { Badge, Button, Card, ErrorNote } from "@ledgeur/ui/components";
import { getSupabase } from "@/lib/supabase";
import { useSession } from "@/lib/useSession";
import { SITE, SUPABASE, TEAM_PRICE_USD } from "@/lib/site";
import CheckoutButton from "@/components/CheckoutButton";

interface Workspace { id: string; name: string; plan: "free" | "team" | "company" }

export default function AccountPanel() {
  const { session, loading, available } = useSession();
  const params = useSearchParams();
  const justPaid = params.get("checkout") === "success";

  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loadingWorkspace, setLoadingWorkspace] = useState(true);
  const [error, setError] = useState("");

  const [tokens, setTokens] = useState<AccessTokenMeta[]>([]);
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const [issuing, setIssuing] = useState(false);
  const [portalBusy, setPortalBusy] = useState(false);

  const refresh = useCallback(async () => {
    const sb = getSupabase();
    if (!sb || !session) { setLoadingWorkspace(false); return; }
    setLoadingWorkspace(true);
    try {
      // RLS returns only workspaces this user belongs to.
      const { data, error: err } = await sb.from("orgs").select("id, name, plan").limit(1).maybeSingle();
      if (err) throw new Error(err.message);
      setWorkspace((data as Workspace) ?? null);
      setTokens(await listAccessTokens(sb));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingWorkspace(false);
    }
  }, [session]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Stripe redirects back the instant the card clears, which is usually before
  // the webhook has updated the row. Re-read a couple of times rather than
  // asking the customer to refresh the page they just paid on.
  useEffect(() => {
    if (!justPaid || !session) return;
    const timers = [2000, 5000, 10000].map((ms) => setTimeout(() => void refresh(), ms));
    return () => timers.forEach(clearTimeout);
  }, [justPaid, session, refresh]);

  const issue = useCallback(async () => {
    const sb = getSupabase();
    if (!sb) return;
    setIssuing(true); setError(""); setFreshToken(null);
    const result = await issueAccessToken(sb, "Web-issued token");
    setIssuing(false);
    if (result.ok) { setFreshToken(result.token); setTokens(await listAccessTokens(sb)); return; }
    setError(result.reason === "upgrade_required"
      ? "Agent access is part of the paid plan. Start the trial above and the token will mint straight away."
      : result.message);
  }, []);

  const revoke = useCallback(async (id: string) => {
    const sb = getSupabase();
    if (!sb) return;
    try {
      await revokeAccessToken(sb, id);
      setTokens(await listAccessTokens(sb));
    } catch (e) { setError((e as Error).message); }
  }, []);

  const openPortal = useCallback(async () => {
    const sb = getSupabase();
    if (!sb) return;
    setPortalBusy(true); setError("");
    try {
      const { data } = await sb.auth.getSession();
      const token = data.session?.access_token;
      const res = await fetch("/api/portal", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
      const body = await res.json();
      if (body.url) { window.location.href = body.url; return; }
      setError(body.error ?? "Could not open the billing portal.");
    } catch {
      setError("Could not reach the server.");
    } finally {
      setPortalBusy(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    await getSupabase()?.auth.signOut();
    window.location.href = "/";
  }, []);

  if (loading) return <Card className="p-7 text-[14px] text-muted">Checking your session…</Card>;

  if (!available) {
    return (
      <Card raised className="p-7">
        <h2 className="ldg-display text-[20px]">Accounts are not available here</h2>
        <p className="mt-3 text-[14.5px] leading-relaxed text-muted">
          This deployment has no backend configured. Ledgeur still works entirely on your device.
        </p>
      </Card>
    );
  }

  if (!session) {
    return (
      <Card raised className="p-7">
        <h2 className="ldg-display text-[20px]">You are not signed in</h2>
        <p className="mt-3 text-[14.5px] leading-relaxed text-muted">
          Sign in to see your plan, manage billing and generate agent access tokens.
        </p>
        <Link href="/signin?next=/account" className="mt-5 inline-block font-medium text-accent-strong hover:underline">
          Sign in →
        </Link>
      </Card>
    );
  }

  const paid = workspace?.plan === "team" || workspace?.plan === "company";

  return (
    <div className="space-y-6">
      {justPaid && !paid && !loadingWorkspace && (
        <Card className="border-warn/30 bg-warn-soft p-5 text-[14px] text-warn">
          Your payment went through. The workspace has not switched over yet — that happens when
          Stripe notifies us, usually within a few seconds. This page is re-checking. If it is still
          saying Free in a minute, email us and we will fix it by hand.
        </Card>
      )}

      {/* ------------------------------------------------------------ plan */}
      <Card raised className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="ldg-kicker">Signed in as</div>
            <p className="mt-1.5 text-[15px] text-ink-text">{session.user.email}</p>
            {workspace && <p className="mt-1 text-[13px] text-faint">Workspace: {workspace.name}</p>}
          </div>
          {loadingWorkspace
            ? <Badge tone="neutral">Checking…</Badge>
            : <Badge tone={paid ? "accent" : "neutral"}>{paid ? "Team plan — active" : "Free plan"}</Badge>}
        </div>

        <div className="mt-6 border-t border-hairline pt-5">
          {paid ? (
            <>
              <p className="text-[14px] leading-relaxed text-muted">
                Sync, the shared library and agent access are on. Change your card, download invoices
                or cancel from the billing portal — no email required.
              </p>
              <Button tone="secondary" onClick={openPortal} disabled={portalBusy} className="mt-4">
                {portalBusy ? "Opening…" : "Manage billing"}
              </Button>
            </>
          ) : (
            <>
              <p className="text-[14px] leading-relaxed text-muted">
                Everything on your device already works and always will. The Team plan adds sync
                across devices, a shared library and agent access, for ${TEAM_PRICE_USD} per person
                per month after a 14-day trial.
              </p>
              <div className="mt-4 max-w-xs">
                <CheckoutButton next="/account" />
              </div>
            </>
          )}
        </div>
      </Card>

      {/* --------------------------------------------------- agent access */}
      <Card raised className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="ldg-display text-[19px] text-ink-text">Agent access</h2>
            <p className="mt-1 text-[13.5px] text-muted">
              A token lets Claude, ChatGPT or Cursor read your meetings over MCP.
            </p>
          </div>
          <Button onClick={issue} disabled={issuing} tone={paid ? "primary" : "secondary"} size="sm">
            {issuing ? "Generating…" : "Generate a token"}
          </Button>
        </div>

        {freshToken && (
          <div className="mt-5 rounded-xl border border-accent/30 bg-accent-soft p-4">
            <p className="text-[13px] font-medium text-accent-strong">
              Copy this now — it is shown once and never again.
            </p>
            <code className="mt-2 block overflow-x-auto rounded-lg bg-ink px-3 py-2.5 font-mono text-[12px] text-on-ink">
              {freshToken}
            </code>
            <p className="mt-3 text-[12.5px] text-accent-strong">
              We store only a hash of it, so we genuinely cannot show it to you again. Lose it and
              you generate another and revoke this one.
            </p>

            <details className="mt-4">
              <summary className="cursor-pointer text-[13px] font-medium text-accent-strong">
                Configuration for your MCP client
              </summary>
              <div className="mt-3 space-y-4">
                <div>
                  <div className="ldg-kicker">Hosted — no process to run</div>
                  <p className="mt-1 text-[12.5px] text-muted">
                    Endpoint: <code className="font-mono">{hostedEndpoint(SITE.url)}</code>
                  </p>
                  <pre className="mt-2 overflow-x-auto rounded-lg bg-ink px-3 py-2.5 font-mono text-[11.5px] text-on-ink">
                    {hostedClientConfig(SITE.url, freshToken)}
                  </pre>
                </div>
                <div>
                  <div className="ldg-kicker">Or run the server yourself</div>
                  <pre className="mt-2 overflow-x-auto rounded-lg bg-ink px-3 py-2.5 font-mono text-[11.5px] text-on-ink">
                    {stdioClientConfig({ supabaseUrl: SUPABASE.url, anonKey: SUPABASE.anonKey, token: freshToken })}
                  </pre>
                </div>
              </div>
            </details>
          </div>
        )}

        {tokens.length > 0 && (
          <ul className="mt-5 divide-y divide-hairline border-t border-hairline">
            {tokens.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <div className="text-[14px] text-ink-text">{t.name}</div>
                  <div className="text-[12px] text-faint">
                    Created {new Date(t.created_at).toLocaleDateString()}
                    {t.last_used_at ? ` · last used ${new Date(t.last_used_at).toLocaleDateString()}` : " · never used"}
                  </div>
                </div>
                <Button tone="ghost" size="sm" onClick={() => revoke(t.id)} className="text-danger">
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        )}

        {tokens.length === 0 && !freshToken && (
          <p className="mt-5 border-t border-hairline pt-4 text-[13.5px] text-faint">
            No tokens yet. <Link href="/agents" className="text-accent-strong hover:underline">How agent access works →</Link>
          </p>
        )}
      </Card>

      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="flex justify-between border-t border-hairline pt-6 text-[13.5px]">
        <Link href="/app" className="font-medium text-accent-strong hover:underline">Open the app →</Link>
        <button onClick={signOut} className="text-muted hover:text-ink-text">Sign out</button>
      </div>
    </div>
  );
}
