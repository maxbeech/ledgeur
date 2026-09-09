// Sync, as a state you can see rather than a promise you have to trust: when
// it last ran, what it moved, whether the other device's changes arrive live,
// and — if the backend is behind — exactly which migration it needs.
import { RefreshCw, Radio } from "lucide-react";
import { Badge, Button, Card, ErrorNote, Notice, Spinner } from "../ui.tsx";
import { useSyncStatus, syncNow } from "../../lib/sync.ts";
import { hasBackend } from "../../lib/config.ts";
import { SITE_PRICING_URL } from "../../lib/links.ts";

export function SyncCard() {
  const s = useSyncStatus();
  if (!hasBackend) return null;

  const tone = s.phase === "error" ? "danger"
    : s.phase === "legacy" ? "warn"
    : s.phase === "free" ? "brand"
    : s.phase === "signed-out" ? "neutral" : "accent";
  const label = s.phase === "syncing" ? "Syncing"
    : s.phase === "error" ? "Failed"
    : s.phase === "legacy" ? "Limited"
    : s.phase === "free" ? "On the free plan"
    : s.phase === "signed-out" ? "Signed out" : "In step";

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-base font-semibold text-ink-text">Sync</span>
            <Badge tone={tone}>{label}</Badge>
            {s.live && <Badge tone="brand"><Radio className="h-3 w-3" /> Live</Badge>}
          </div>
          <p className="mt-1 text-sm text-muted">
            {s.phase === "signed-out"
              ? "Sign in above and every meeting, space and recipe follows you between this device and your phone."
              : s.lastSyncAt
                ? `Last synced ${new Date(s.lastSyncAt).toLocaleTimeString()} — ${s.pushed} sent, ${s.pulled} received.`
                : "Not synced yet."}
          </p>
        </div>
        {s.phase !== "signed-out" && (
          <Button size="sm" tone="secondary" onClick={() => void syncNow("manual")} disabled={s.phase === "syncing"}>
            {s.phase === "syncing" ? <Spinner /> : <RefreshCw className="h-4 w-4" />} Sync now
          </Button>
        )}
      </div>
      {s.phase === "error" && <ErrorNote className="mt-3">{s.error}</ErrorNote>}
      {/* Not an error note: nothing has gone wrong. This is the price, said
          where somebody is looking for the reason. */}
      {s.phase === "free" && (
        <Notice tone="brand" className="mt-3">
          {s.error}{" "}
          <a href={SITE_PRICING_URL} target="_blank" rel="noreferrer" className="font-medium underline">
            What the Team plan adds
          </a>
        </Notice>
      )}
      {s.phase === "legacy" && (
        <Notice tone="warn" className="mt-3">
          {s.error} The migration is <code className="font-mono">supabase/migrations/0007_sync.sql</code> in the repository.
        </Notice>
      )}
    </Card>
  );
}
