// Generated from OpenHelm/shared/src/analytics-return-browser.ts; use install-active-return.mjs.
/** Browser adapter shared with generated product clients. Consent is a port. */
import {
  ACTIVE_RETURN_POLICY, parseReturnState, reduceActiveReturn,
  type ActiveReturnPolicy, type ActiveReturnSignal,
} from "./analytics-return";

export type ActiveReturnListener = (event: { isTrusted: boolean }) => void;
export interface ActiveReturnBrowserPorts {
  storage: { getItem(key: string): string | null; setItem(key: string, value: string): void };
  document: {
    visibilityState: string;
    addEventListener(type: string, listener: ActiveReturnListener, options?: { passive: boolean }): void;
    removeEventListener(type: string, listener: ActiveReturnListener): void;
  };
  now: () => number;
  consented: () => boolean;
  send: (name: string, params: Record<string, string | number>) => boolean;
  onError: (error: Error) => void;
}

/**
 * Storage is read for every signal so sibling tabs share one cohort and return.
 * An unavailable/corrupt store reports an error and sends nothing; starting an
 * in-memory replacement cohort would fabricate new users and false returns.
 */
export function observeActiveReturns(
  ports: ActiveReturnBrowserPorts, policy: ActiveReturnPolicy = ACTIVE_RETURN_POLICY,
): () => void {
  const key = `openhelm:analytics:${policy.version}`;
  const apply = (kind: ActiveReturnSignal["kind"], trusted: boolean) => {
    try {
      if (!ports.consented()) return;
      const previous = parseReturnState(ports.storage.getItem(key), policy);
      const next = reduceActiveReturn(previous, {
        now: ports.now(), kind, trusted, visible: ports.document.visibilityState === "visible",
      }, policy);
      if (!next.state) return;
      // Persist before dispatch: another tab must not count the same return.
      ports.storage.setItem(key, JSON.stringify(next.state));
      for (const event of next.events) {
        if (!ports.send(event.name, event.params)) throw new Error(`Active return event ${event.name} could not be queued`);
      }
    } catch (error) {
      ports.onError(error instanceof Error ? error : new Error(String(error)));
    }
  };
  const interact: ActiveReturnListener = (event) => apply("interaction", event.isTrusted);
  const visit: ActiveReturnListener = () => apply("visit", false);
  const types = ["pointerdown", "keydown"] as const;
  for (const type of types) ports.document.addEventListener(type, interact, { passive: true });
  ports.document.addEventListener("visibilitychange", visit);
  apply("visit", false);
  return () => {
    for (const type of types) ports.document.removeEventListener(type, interact);
    ports.document.removeEventListener("visibilitychange", visit);
  };
}
