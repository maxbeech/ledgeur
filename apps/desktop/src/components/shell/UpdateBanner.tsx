// A thin strip above the app chrome when a new version is ready — real state
// only: it renders nothing until useAppUpdate actually finds a release newer
// than the running build. "Later" hides it for this launch; the update is
// still there next time the app opens.
import { useState } from "react";
import { Download, RefreshCcw, AlertCircle } from "lucide-react";
import { Button, Spinner } from "../ui.tsx";
import { useAppUpdate } from "../../lib/useAppUpdate.ts";

function formatBytes(n: number): string {
  const mb = n / 1_000_000;
  return mb < 1 ? `${Math.round(n / 1000)} KB` : `${mb.toFixed(1)} MB`;
}

export function UpdateBanner() {
  const { status, update, progress, error, install } = useAppUpdate();
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || (status !== "available" && status !== "installing" && status !== "error")) return null;

  return (
    <div className="flex shrink-0 items-center justify-between gap-3 border-b border-hairline bg-accent-soft/60 px-4 py-2 text-xs text-ink-text">
      <div className="flex min-w-0 items-center gap-2">
        {status === "error" ? <AlertCircle className="h-3.5 w-3.5 shrink-0 text-danger" /> : <RefreshCcw className="h-3.5 w-3.5 shrink-0 text-accent-strong" />}
        {status === "error" ? (
          <span className="truncate">Couldn't install v{update?.version}: {error}</span>
        ) : status === "installing" ? (
          <span className="truncate">
            Installing v{update?.version}
            {progress?.total ? ` — ${formatBytes(progress.downloaded)} of ${formatBytes(progress.total)}` : "…"}
          </span>
        ) : (
          <span className="truncate">Ledgeur {update?.version} is ready — you're on {update?.currentVersion}.</span>
        )}
      </div>
      {status === "installing" ? (
        <Spinner className="shrink-0" />
      ) : (
        <div className="flex shrink-0 items-center gap-2">
          <Button size="sm" onClick={() => void install()}>
            <Download className="h-3.5 w-3.5" /> {status === "error" ? "Try again" : "Update now"}
          </Button>
          {status !== "error" && (
            <button onClick={() => setDismissed(true)} className="text-[11px] text-muted underline">Later</button>
          )}
        </div>
      )}
    </div>
  );
}
