// Contextely — Beech's shared company-memory layer — connected in BOTH
// directions, because "integrated with Contextely" only half-happened before.
//
//   Contextely → Ledgeur   the company's memory (Notion, Drive, Postgres,
//                          anything else connected there) is searched alongside
//                          your meetings when you ask a question. This half
//                          already worked: paste a personal API key.
//
//   Ledgeur → Contextely   your meetings BECOME company memory, so anyone
//                          entitled to them can get an answer from what was
//                          actually said. This half is what was missing.
//
// The second direction is not a bespoke push endpoint. Contextely ingests over
// MCP (it is an MCP *client* as well as a server) and already ships a Ledgeur
// preset that calls `list_meetings` and `get_meeting`. Ledgeur already serves
// both, over the hosted endpoint. So the integration is a configuration, not a
// protocol — and what was actually broken was the shape of the records those
// tools returned (see packages/mcp/src/tools.ts). All this card has to do is
// hand over the two values Contextely asks for.

import { useEffect, useState } from "react";
import { Brain, Check, Copy, ArrowLeftRight } from "lucide-react";
import { hostedEndpoint } from "@ledgeur/mcp";
import { Button, Card, Chip, Spinner } from "../ui.tsx";
import { openExternal } from "../../lib/runtime.ts";
import { SITE_URL } from "../../lib/links.ts";
import {
  CONTEXTELY_SIGNUP_URL, CONTEXTELY_SOURCES_URL,
  connectContextely, disconnectContextely, isContextelyConnected,
} from "../../lib/contextely.ts";

export function ContextelyCard({ signedIn }: { signedIn: boolean }) {
  const [connected, setConnected] = useState(false);
  const [key, setKey] = useState("");
  const [state, setState] = useState<{ busy: boolean; err: string }>({ busy: false, err: "" });
  const [copied, setCopied] = useState(false);

  useEffect(() => { if (signedIn) void isContextelyConnected().then(setConnected); }, [signedIn]);

  async function connect() {
    setState({ busy: true, err: "" });
    try {
      await connectContextely(key);
      setConnected(true); setKey("");
      setState({ busy: false, err: "" });
    } catch (e) {
      setState({ busy: false, err: e instanceof Error ? e.message : String(e) });
    }
  }

  async function disconnect() {
    setState({ busy: true, err: "" });
    try {
      await disconnectContextely();
      setConnected(false);
      setState({ busy: false, err: "" });
    } catch (e) {
      setState({ busy: false, err: e instanceof Error ? e.message : String(e) });
    }
  }

  const endpoint = hostedEndpoint(SITE_URL);

  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-muted text-ink-text">
          <Brain className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-ink-text">Contextely</span>
            {connected && <Chip tone="accent"><Check className="h-3 w-3" /> connected</Chip>}
          </div>
          <p className="mt-0.5 text-xs leading-relaxed text-muted">
            Your company's shared memory. Connected both ways: Contextely's knowledge answers
            questions here, and your meetings become part of that memory for everyone entitled
            to them.
          </p>

          {/* ---- Contextely → Ledgeur ---- */}
          <div className="mt-4 border-t border-hairline pt-3">
            <div className="ldg-kicker mb-1.5">Company memory, in your questions</div>
            {!signedIn ? (
              <div className="text-xs text-muted">Sign in above to connect Contextely.</div>
            ) : connected ? (
              <div className="flex items-center gap-3">
                <p className="flex-1 text-[11.5px] leading-relaxed text-faint">
                  Ask and the meeting copilot now search Contextely alongside your own meetings.
                </p>
                <Button size="sm" variant="outline" onClick={disconnect} disabled={state.busy}>
                  {state.busy ? <Spinner /> : "Disconnect"}
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-[11.5px] leading-relaxed text-faint">
                  Paste a personal API key from your Contextely dashboard. It is validated and kept
                  server-side — it never touches this device's storage.
                </p>
                <div className="flex gap-2">
                  <input
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                    name="contextely-key"
                    type="password"
                    placeholder="ctx_sk_…"
                    className="flex-1 rounded-lg border border-hairline bg-surface px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-accent/40"
                  />
                  <Button onClick={connect} disabled={!key.trim() || state.busy}>
                    {state.busy ? <Spinner /> : "Connect"}
                  </Button>
                </div>
                <Button size="sm" variant="ghost" onClick={() => void openExternal(CONTEXTELY_SIGNUP_URL)}>
                  Get a key at contextely.com
                </Button>
              </div>
            )}
          </div>

          {/* ---- Ledgeur → Contextely ---- */}
          <div className="mt-4 border-t border-hairline pt-3">
            <div className="ldg-kicker mb-1.5 flex items-center gap-1.5">
              <ArrowLeftRight className="h-3 w-3" /> Your meetings, as company memory
            </div>
            <p className="text-[11.5px] leading-relaxed text-faint">
              In Contextely, add a source and choose <span className="text-ink-text">Ledgeur</span>. It asks for
              two things: this endpoint, and a data-access token — generate one under
              <span className="text-ink-text"> Agent access</span> below. Contextely then keeps your meetings
              condensed and refreshed on its own; nothing is pushed from here.
            </p>
            <div className="mt-2 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg border border-hairline bg-surface-sunken px-2.5 py-1.5 font-mono text-[11px] text-ink-text">
                {endpoint}
              </code>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  void navigator.clipboard.writeText(endpoint);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <Button size="sm" variant="ghost" className="mt-1.5" onClick={() => void openExternal(CONTEXTELY_SOURCES_URL)}>
              Open Contextely sources
            </Button>
          </div>

          {state.err && <div className="mt-2 text-xs text-danger">{state.err}</div>}
        </div>
      </div>
    </Card>
  );
}
