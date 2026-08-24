import { useState } from "react";
import { Calendar, Check } from "lucide-react";
import { Button, Card, Chip, Spinner } from "../ui.tsx";
import { hasBackend } from "../../lib/config.ts";
import { useSession, signInWith } from "../../lib/session.ts";
import { useTodayEvents } from "../../lib/useCalendar.ts";

/** Google Calendar connection card. Calendar access rides on the Supabase Auth
 *  Google sign-in (see session.ts) rather than a separate OAuth flow — this
 *  card just reflects that real state and offers the same sign-in action. */
export function GoogleCalendarCard() {
  const { session } = useSession();
  const { events, error } = useTodayEvents();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const provider = session?.user.app_metadata?.provider;
  const connected = provider === "google";

  async function connect() {
    setBusy(true); setErr("");
    try {
      await signInWith("google");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex items-start gap-3 p-4">
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-muted text-ink-text"><Calendar className="h-5 w-5" /></span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-ink-text">Google Calendar</span>
          {connected ? <Chip tone="accent"><Check className="h-3 w-3" /> connected</Chip> : <Chip tone="accent">first to ship</Chip>}
        </div>
        <p className="mt-0.5 text-xs leading-relaxed text-muted">See meetings, get one-click record prompts, and ground Ask in your schedule.</p>

        {!hasBackend ? (
          <div className="mt-3"><Button variant="outline" disabled title="Configure Supabase to enable">Backend required</Button></div>
        ) : !session ? (
          <div className="mt-3 space-y-2">
            <Button variant="outline" onClick={() => void connect()} disabled={busy}>{busy ? <Spinner /> : "Connect Google Calendar"}</Button>
            {err && <div className="text-xs text-danger">{err}</div>}
          </div>
        ) : !connected ? (
          <div className="mt-3 text-xs text-muted">Signed in with {provider ?? "another provider"}. Sign out to connect Google Calendar instead.</div>
        ) : (
          <div className="mt-3 text-xs text-muted">
            {error ? error : events === null ? "Loading today's events…" : `${events.length} event${events.length === 1 ? "" : "s"} today`}
          </div>
        )}
      </div>
    </Card>
  );
}
