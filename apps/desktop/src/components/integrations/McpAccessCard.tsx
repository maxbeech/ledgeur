import { useState } from "react";
import { Server, Copy, Check } from "lucide-react";
import type { Session } from "@supabase/supabase-js";
import { Button, Card, Chip, Spinner } from "../ui.tsx";
import { generateMcpConfig, type McpConfigResult } from "../../lib/mcp.ts";
import { openExternal } from "../../lib/runtime.ts";
import { upgradeUrl } from "../../lib/links.ts";

/** Agent access — the paid tier. Free workspaces get an honest upgrade path;
 *  paid ones get a paste-ready config for whichever transport their client
 *  speaks. The token is shown once, because only its hash is stored. */
export function McpAccessCard({ session }: { session: Session | null }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<McpConfigResult | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<"hosted" | "stdio" | null>(null);

  async function generate() {
    if (!session) { setError("Sign in first."); return; }
    setBusy(true); setError(""); setResult(null);
    try {
      setResult(await generateMcpConfig());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function copy(which: "hosted" | "stdio", text: string) {
    void navigator.clipboard.writeText(text);
    setCopied(which);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <Card className="p-5">
      <div className="flex items-start gap-3">
        <Server className="mt-0.5 h-5 w-5 text-glow" />
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-ink-text">Agent access</span>
            <Chip tone="warn">Paid</Chip>
          </div>
          <p className="mt-0.5 max-w-xl text-xs leading-relaxed text-muted">
            The app is free. Letting an agent read your meetings is the paid tier: connect Claude,
            ChatGPT or any MCP-aware tool and it can list, search and read what you have recorded —
            as you, under the same permissions you have.
          </p>
          <div className="mt-3">
            <Button
              variant="outline"
              onClick={generate}
              disabled={busy || !session}
              title={session ? undefined : "Sign in to generate a token"}
            >
              {busy ? <Spinner /> : "Generate a token"}
            </Button>
          </div>

          {result && !result.paid && (
            <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl bg-warn-soft px-3.5 py-2.5 text-xs text-warn">
              <span>This workspace is on the free plan, so there is nothing to connect to yet.</span>
              <Button onClick={() => void openExternal(upgradeUrl())}>Upgrade</Button>
            </div>
          )}

          {error && <div className="mt-3 text-xs text-danger">{error}</div>}

          {result?.paid && result.token && (
            <div className="mt-4 space-y-4">
              <div className="rounded-xl border border-accent/30 bg-accent-soft p-3">
                <div className="text-[11px] font-medium text-accent-strong">
                  Copy this now — it is shown once and never again.
                </div>
                <code className="mt-1.5 block overflow-x-auto rounded-lg bg-ink px-2.5 py-2 font-mono text-[11px] text-on-ink">
                  {result.token}
                </code>
                <p className="mt-1.5 text-[11px] text-accent-strong">
                  Only a hash of it is stored, so we cannot show it to you again. Revoke it any time
                  from your account page.
                </p>
              </div>

              <ConfigBlock
                title="Hosted — nothing to install"
                hint="Point any MCP client that speaks HTTP at this. No process, no Node."
                config={result.hosted ?? ""}
                copied={copied === "hosted"}
                onCopy={() => copy("hosted", result.hosted ?? "")}
              />
              <ConfigBlock
                title="Or run the server yourself"
                hint="For clients that only speak stdio."
                config={result.stdio ?? ""}
                copied={copied === "stdio"}
                onCopy={() => copy("stdio", result.stdio ?? "")}
              />
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function ConfigBlock({
  title, hint, config, copied, onCopy,
}: { title: string; hint: string; config: string; copied: boolean; onCopy: () => void }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-3">
        <div>
          <span className="text-xs font-medium text-ink-text">{title}</span>
          <p className="text-[11px] text-muted">{hint}</p>
        </div>
        <button onClick={onCopy} className="inline-flex shrink-0 items-center gap-1 text-xs text-accent-strong">
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="max-h-52 overflow-auto rounded-xl bg-ink p-3 text-[11px] leading-relaxed text-on-ink">{config}</pre>
    </div>
  );
}
