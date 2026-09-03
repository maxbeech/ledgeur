import { useEffect, useState } from "react";
import { Brain, Check } from "lucide-react";
import { Button, Card, Chip, Spinner } from "../ui.tsx";
import { openExternal } from "../../lib/runtime.ts";
import {
  CONTEXTELY_SIGNUP_URL, connectContextely, disconnectContextely, isContextelyConnected,
} from "../../lib/contextely.ts";

/** Contextely connection card: paste a personal API key (no OAuth), used to
 *  pull the company's shared memory into Ask and the copilot. */
export function ContextelyCard({ signedIn }: { signedIn: boolean }) {
  const [connected, setConnected] = useState(false);
  const [key, setKey] = useState("");
  const [state, setState] = useState<{ busy: boolean; err: string }>({ busy: false, err: "" });

  useEffect(() => { if (signedIn) isContextelyConnected().then(setConnected); }, [signedIn]);

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

  return (
    <Card className="flex items-start gap-3 p-4">
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-muted text-ink-text"><Brain className="h-5 w-5" /></span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-ink-text">Contextely</span>
          {connected && <Chip tone="accent"><Check className="h-3 w-3" /> connected</Chip>}
        </div>
        <p className="mt-0.5 text-xs leading-relaxed text-muted">
          The company's shared memory — Notion, Drive, Postgres and anything else your org has
          connected there — searched alongside your meetings when you ask a question.
        </p>

        {!signedIn ? (
          <div className="mt-3 text-xs text-muted">Sign in above to connect Contextely.</div>
        ) : connected ? (
          <div className="mt-3">
            <Button size="sm" variant="outline" onClick={disconnect} disabled={state.busy}>
              {state.busy ? <Spinner /> : "Disconnect"}
            </Button>
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            <Button variant="outline" onClick={() => void openExternal(CONTEXTELY_SIGNUP_URL)}>Get a key at contextely.com</Button>
            <div className="flex gap-2">
              <input
                value={key}
                onChange={(e) => setKey(e.target.value)}
                name="contextely-key"
                type="password"
                placeholder="ctx_sk_…"
                className="flex-1 rounded-lg border border-hairline bg-surface px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-accent/40"
              />
              <Button onClick={connect} disabled={!key.trim() || state.busy}>{state.busy ? <Spinner /> : "Connect"}</Button>
            </div>
          </div>
        )}
        {state.err && <div className="mt-2 text-xs text-danger">{state.err}</div>}
      </div>
    </Card>
  );
}
