// Generated from OpenHelm/shared/src/analytics-return.ts; use install-active-return.mjs.
/**
 * Provider-neutral active-return contract. Products receive this module through
 * Products/_services/openhelm-analytics; the installer copies it verbatim.
 * No timers create returns: only a visible, trusted interaction can do so.
 */
export interface ActiveReturnPolicy {
  version: string;
  minimumGapMs: number;
  sessionIdleMs: number;
  observationWindowMs: number;
  firstVisitEvent: string;
  returnEvent: string;
}

export const ACTIVE_RETURN_POLICY: Readonly<ActiveReturnPolicy> = Object.freeze({
  version: "active-return-v1",
  minimumGapMs: 3 * 60 * 60 * 1000,
  sessionIdleMs: 30 * 60 * 1000,
  observationWindowMs: 7 * 24 * 60 * 60 * 1000,
  firstVisitEvent: "oh_first_visit",
  returnEvent: "oh_active_return",
});

export interface ActiveReturnState {
  version: string;
  firstSeenAt: number;
  sessionStartedAt: number;
  lastInteractionAt: number;
  returnedAt: number | null;
}

export interface ActiveReturnSignal {
  now: number;
  kind: "visit" | "interaction";
  visible: boolean;
  trusted: boolean;
}

export interface ActiveReturnEvent { name: string; params: Record<string, string | number> }

export function validateReturnPolicy(policy: ActiveReturnPolicy): void {
  if (!policy.version || !policy.firstVisitEvent || !policy.returnEvent ||
      policy.firstVisitEvent === policy.returnEvent) throw new Error("Active return policy needs a version and distinct event names");
  for (const key of ["minimumGapMs", "sessionIdleMs", "observationWindowMs"] as const) {
    if (!Number.isSafeInteger(policy[key]) || policy[key] <= 0) throw new Error(`Active return policy ${key} must be a positive integer`);
  }
  if (policy.observationWindowMs <= policy.minimumGapMs) throw new Error("Active return window must exceed its minimum gap");
}

export function parseReturnState(raw: string | null, policy: ActiveReturnPolicy): ActiveReturnState | null {
  if (raw === null) return null;
  const state: unknown = JSON.parse(raw);
  if (!state || typeof state !== "object") throw new Error("Active return state must be an object");
  const s = state as ActiveReturnState;
  if (s.version !== policy.version) return null;
  for (const key of ["firstSeenAt", "sessionStartedAt", "lastInteractionAt"] as const) {
    if (!Number.isSafeInteger(s[key]) || s[key] < 0) throw new Error(`Invalid active return state ${key}`);
  }
  if (s.sessionStartedAt < s.firstSeenAt || s.lastInteractionAt < s.sessionStartedAt ||
      (s.returnedAt !== null && (!Number.isSafeInteger(s.returnedAt) || s.returnedAt < s.firstSeenAt))) {
    throw new Error("Active return state has inconsistent timestamps");
  }
  return s;
}

/** A new version starts a new measured cohort; historical visits are never invented. */
export function reduceActiveReturn(
  previous: ActiveReturnState | null,
  signal: ActiveReturnSignal,
  policy: ActiveReturnPolicy = ACTIVE_RETURN_POLICY,
): { state: ActiveReturnState | null; events: ActiveReturnEvent[] } {
  validateReturnPolicy(policy);
  if (!Number.isSafeInteger(signal.now) || signal.now < 0) throw new Error("Active return signal needs a valid timestamp");
  if (!signal.visible || (signal.kind === "interaction" && !signal.trusted)) return { state: previous, events: [] };
  const isNew = !previous || previous.version !== policy.version;
  const state = isNew ? {
    version: policy.version, firstSeenAt: signal.now, sessionStartedAt: signal.now,
    lastInteractionAt: signal.now, returnedAt: null,
  } : { ...previous };
  if (signal.now < state.lastInteractionAt) throw new Error("Active return clock moved backwards");
  const event = (name: string): ActiveReturnEvent => ({ name, params: {
    oh_return_contract: policy.version,
    oh_cohort_date: new Date(state.firstSeenAt).toISOString().slice(0, 10),
    oh_return_gap_ms: policy.minimumGapMs,
    oh_return_window_ms: policy.observationWindowMs,
  } });
  const events = isNew ? [event(policy.firstVisitEvent)] : [];
  // Visits (including reloads) must not keep an idle session alive. The first
  // intentional interaction after an idle gap starts a genuinely new session.
  if (signal.kind === "interaction") {
    if (signal.now - state.lastInteractionAt >= policy.sessionIdleMs) state.sessionStartedAt = signal.now;
    state.lastInteractionAt = signal.now;
    if (state.returnedAt === null && state.sessionStartedAt - state.firstSeenAt >= policy.minimumGapMs &&
        signal.now - state.firstSeenAt <= policy.observationWindowMs) {
      state.returnedAt = signal.now;
      events.push(event(policy.returnEvent));
    }
  }
  return { state, events };
}
