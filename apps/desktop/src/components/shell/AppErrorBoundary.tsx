import { Component, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@ledgeur/ui/components";
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
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-danger-soft text-danger">
          <AlertTriangle className="h-5 w-5" strokeWidth={2} />
        </span>
        <p className="text-lg font-semibold text-ink-text">Something went wrong.</p>
        <p className="max-w-md text-sm text-muted">{this.state.error.message}</p>
        <Button tone="secondary" className="mt-2" onClick={() => window.location.reload()}>Reload</Button>
      </div>
    );
  }
}
