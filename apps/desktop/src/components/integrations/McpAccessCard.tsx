import { useState } from "react";
import { Server, Copy, Check } from "lucide-react";
import type { Session } from "@supabase/supabase-js";
import { Button, Card, Chip, Spinner } from "../ui.tsx";
import { generateMcpConfig } from "../../lib/mcp.ts";
import { openExternal } from "../../lib/runtime.ts";
import { pricingUrlForOrg } from "../../lib/links.ts";
import { getSupabase } from "../../lib/supabase.ts";

/** The paid MCP data-access card. Plan-gated: free → upgrade CTA; paid → config. */
export function McpAccessCard({ session }: { session: Session | null }) {
  const [state, setState] = useState<{ busy: boolean; config: string; err: string; upgrade: boolean }>(
    { busy: false, config: "", err: "", upgrade: false },
  );
  const [copied, setCopied] = useState(false);

  async function generate() {
    if (!session) { setState((s) => ({ ...s, err: "Sign in first." })); return; }
    setState({ busy: true, config: "", err: "", upgrade: false });
    try {
      const res = await generateMcpConfig(session);
      if (!res.paid) setState({ busy: false, config: "", err: "", upgrade: true });
      else setState({ busy: false, config: res.config ?? "", err: "", upgrade: false });
    } catch (e) {
      setState({ busy: false, config: "", err: e instanceof Error ? e.message : String(e), upgrade: false });
    }
  }

  return (
    <Card className="p-5">
      <div className="flex items-start gap-3">
        <Server className="mt-0.5 h-5 w-5 text-glow" />
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-ink-text">Ledgeur MCP server</span>
            <Chip tone="warn">Paid</Chip>
          </div>
          <p className="mt-0.5 max-w-xl text-xs leading-relaxed text-muted">
            The app is free. Programmatic access to your knowledge base is the paid tier: connect Claude, ChatGPT or any MCP-aware tool to query your meetings, notes and tasks.
          </p>
          <div className="mt-3">
            <Button variant="outline" onClick={generate} disabled={state.busy || !session}
              title={session ? undefined : "Sign in to generate access"}>
              {state.busy ? <Spinner /> : "Generate MCP config"}
            </Button>
          </div>

          {state.upgrade && (
            <div className="mt-3 flex items-center gap-3 rounded-xl bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800">
              Your workspace is on the free plan. Upgrade to unlock data access.
              <Button
                onClick={async () => {
                  const sb = getSupabase();
                  const { data: org } = (await sb?.from("orgs").select("id").limit(1).maybeSingle()) ?? { data: null };
                  void openExternal(pricingUrlForOrg(org?.id));
                }}
              >
                Upgrade
              </Button>
            </div>
          )}
          {state.err && <div className="mt-3 text-xs text-red-600">{state.err}</div>}
          {state.config && (
            <div className="mt-3">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-medium text-ink-text">Add this to your MCP client config:</span>
                <button onClick={() => { void navigator.clipboard.writeText(state.config); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
                  className="inline-flex items-center gap-1 text-xs text-accent-strong">
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <pre className="max-h-52 overflow-auto rounded-xl bg-ink p-3 text-[11px] leading-relaxed text-on-ink">{state.config}</pre>
              <p className="mt-1 text-[11px] text-muted">Contains a personal token — keep it secret. Revoke anytime by signing out.</p>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
