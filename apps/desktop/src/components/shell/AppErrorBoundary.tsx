import { Component, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { createLogger } from "../../lib/logger.ts";

const log = createLogger("app-error-boundary");

interface State {
  error: Error | null;
}

export class AppErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    log.error("render crash", error);
    log.debug("component stack", info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center gap-3 bg-surface p-6 text-center">
        <AlertTriangle className="h-8 w-8 text-muted" strokeWidth={2} />
        <p className="font-mono text-sm text-ink">Something went wrong.</p>
        <p className="max-w-md text-xs text-muted">{this.state.error.message}</p>
        <button
          className="mt-2 rounded-lg border border-hairline bg-surface-muted/40 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.1em] text-ink hover:bg-surface-muted"
          onClick={() => window.location.reload()}
        >
          Reload
        </button>
      </div>
    );
  }
}
