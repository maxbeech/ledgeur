import { useEffect, useState } from "react";
import { FileText, Check } from "lucide-react";
import { Button, Card, Chip, Spinner } from "../ui.tsx";
import { openExternal } from "../../lib/runtime.ts";
import { hasBackend } from "../../lib/config.ts";
import { notionConfigured, notionAuthUrl, completeNotionConnect, isNotionConnected } from "../../lib/notion.ts";
import { notionAutoSaveEnabled, setNotionAutoSave } from "../../lib/afterMeeting.ts";

/** Notion connection card: OAuth (open authorize → paste code), + auto-save toggle. */
export function NotionCard({ signedIn }: { signedIn: boolean }) {
  const [connected, setConnected] = useState(false);
  const [code, setCode] = useState("");
  const [state, setState] = useState<{ busy: boolean; err: string }>({ busy: false, err: "" });
  const [autosave, setAutosave] = useState(notionAutoSaveEnabled());

  useEffect(() => { if (signedIn) isNotionConnected().then(setConnected); }, [signedIn]);

  async function connect() {
    setState({ busy: true, err: "" });
    try {
      await completeNotionConnect(code);
      setConnected(true); setCode("");
      setState({ busy: false, err: "" });
    } catch (e) {
      setState({ busy: false, err: e instanceof Error ? e.message : String(e) });
    }
  }

  return (
    <Card className="flex items-start gap-3 p-4">
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-muted text-ink-text"><FileText className="h-5 w-5" /></span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-ink-text">Notion</span>
          {connected ? <Chip tone="accent"><Check className="h-3 w-3" /> Connected</Chip> : <Chip tone="accent">First to ship</Chip>}
        </div>
        <p className="mt-0.5 text-xs leading-relaxed text-muted">Save meeting notes to a Notion database.</p>

        {!hasBackend ? (
          <div className="mt-3"><Button variant="outline" disabled title="Configure Supabase to enable">Backend required</Button></div>
        ) : !signedIn ? (
          <div className="mt-3 text-xs text-muted">Sign in above to connect Notion.</div>
        ) : connected ? (
          <label className="mt-3 flex items-center gap-2 text-xs text-ink-text">
            <input type="checkbox" checked={autosave} onChange={(e) => { setAutosave(e.target.checked); setNotionAutoSave(e.target.checked); }} className="h-4 w-4 accent-[var(--color-accent-strong)]" />
            Auto-save every meeting's notes to Notion
          </label>
        ) : notionConfigured() ? (
          <div className="mt-3 space-y-2">
            <Button variant="outline" onClick={() => void openExternal(notionAuthUrl())}>Authorize in Notion</Button>
            <div className="flex gap-2">
              <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Paste the code Notion gives you"
                className="flex-1 rounded-lg border border-hairline bg-surface px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-accent/40" />
              <Button onClick={connect} disabled={!code.trim() || state.busy}>{state.busy ? <Spinner /> : "Finish"}</Button>
            </div>
            {state.err && <div className="text-xs text-red-600">{state.err}</div>}
          </div>
        ) : (
          <div className="mt-3 text-xs text-muted">Set VITE_NOTION_CLIENT_ID to enable Notion OAuth.</div>
        )}
      </div>
    </Card>
  );
}
