// Delivering the meeting.completed webhook.
//
// The contract — payload shape, signature, what is and isn't allowed to leave
// the device — lives in @ledgeur/core (notes/webhook.ts) and is unit-tested.
// This is the delivery: retries, the record of what happened, and never letting
// a webhook failure affect the meeting it is about.
//
// ── Retries ─────────────────────────────────────────────────────────────────
// Three attempts with backoff, because the common failure is a receiver that is
// briefly down or rate-limiting, not one that is wrong. 4xx other than 408/429
// is not retried: the receiver has told us the request is unacceptable, and
// sending it twice more is just noise in somebody's logs.
//
// ── Why this does not use fetch in the app ──────────────────────────────────
// Ledgeur runs in a webview, so `fetch` obeys the browser's same-origin rules:
// a cross-origin POST with custom headers (which every signed delivery is)
// triggers a CORS preflight, and the request only proceeds if the receiver
// answers it. Webhook endpoints do not — Zapier catch hooks, n8n and internal
// CRMs are not called by browsers and have no reason to implement CORS. Sending
// this with fetch therefore fails against almost every real receiver, with a
// bare "Failed to fetch" that looks identical to a typo in the URL.
//
// In the desktop app the POST goes through the native side (src-tauri/net.rs),
// where there is no origin and no preflight. In the browser preview there is no
// native side, so it falls back to fetch and CORS applies — which is a
// limitation of the preview, not of the product.

import { buildWebhookPayload, webhookHeaders, webhookUrlError } from "@ledgeur/core";
import { getSettings } from "./settings.ts";
import { isTauri } from "./runtime.ts";
import type { LocalMeeting } from "./meetingsStore.ts";
import { createLogger } from "./logger.ts";

const log = createLogger("webhook");

const ATTEMPTS = 3;
const BACKOFF_MS = [0, 1_000, 4_000];
const REQUEST_TIMEOUT_MS = 15_000;

export interface DeliveryResult {
  ok: boolean;
  /** HTTP status of the last attempt, when there was a response at all. */
  status?: number;
  /** Present when it failed — the receiver's own words where we have them. */
  error?: string;
  attempts: number;
}

/** The last delivery's outcome, so Settings can show a real state rather than
 *  "configured" with no evidence it has ever worked. */
export interface DeliveryRecord extends DeliveryResult {
  at: string;
  meetingTitle: string;
}

const LAST_KEY = "ledgeur.webhook.last";

export function lastDelivery(): DeliveryRecord | null {
  try {
    const raw = localStorage.getItem(LAST_KEY);
    return raw ? (JSON.parse(raw) as DeliveryRecord) : null;
  } catch {
    return null;
  }
}

function recordDelivery(record: DeliveryRecord): void {
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify(record));
  } catch {
    /* storage unavailable — the log line below is still the record */
  }
}

const retryable = (status: number) => status >= 500 || status === 408 || status === 429;

/** One POST, native where there is a native side. See the header. */
async function sendOnce(
  url: string, headers: Record<string, string>, body: string,
): Promise<{ status: number; text: string }> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    const reply = await invoke<{ status: number; body: string }>("http_post", {
      url, headers, body, timeoutMs: REQUEST_TIMEOUT_MS,
    });
    return { status: reply.status, text: reply.body };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: "POST", headers, body, signal: controller.signal });
    return { status: res.status, text: await res.text().catch(() => "") };
  } catch (e) {
    if (controller.signal.aborted) throw new Error("Timed out.");
    // "Failed to fetch" in a browser almost always means the receiver did not
    // answer the CORS preflight — say so, rather than leaving the user to
    // suspect their URL.
    throw new Error(
      e instanceof TypeError
        ? "The browser blocked the request (the receiver did not allow a cross-origin POST). This works in the desktop app, which sends it natively."
        : e instanceof Error ? e.message : String(e),
    );
  } finally {
    clearTimeout(timer);
  }
}

/** POST one payload, with retries. Never throws. */
async function post(url: string, body: string, secret: string): Promise<DeliveryResult> {
  let last: DeliveryResult = { ok: false, error: "Not attempted.", attempts: 0 };
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    if (BACKOFF_MS[attempt]) await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt]));
    try {
      const headers = await webhookHeaders(body, String(Math.floor(Date.now() / 1000)), secret || undefined);
      const { status, text } = await sendOnce(url, headers, body);
      if (status >= 200 && status < 300) return { ok: true, status, attempts: attempt + 1 };
      last = { ok: false, status, error: `${status} ${text.slice(0, 200)}`.trim(), attempts: attempt + 1 };
      if (!retryable(status)) return last;
    } catch (e) {
      last = { ok: false, error: e instanceof Error ? e.message : String(e), attempts: attempt + 1 };
    }
  }
  return last;
}

/**
 * Deliver a finished meeting, if a webhook is configured.
 *
 * Returns null when there is nothing to do, so the caller can tell "no webhook"
 * from "webhook failed" — and never throws, because a webhook is a side effect
 * of the meeting and must not be able to fail saving it.
 */
export async function deliverMeeting(meeting: LocalMeeting): Promise<DeliveryResult | null> {
  const { webhookUrl, webhookSecret, webhookIncludeTranscript } = getSettings();
  const url = webhookUrl.trim();
  if (!url) return null;

  const invalid = webhookUrlError(url);
  if (invalid) {
    const result: DeliveryResult = { ok: false, error: invalid, attempts: 0 };
    recordDelivery({ ...result, at: new Date().toISOString(), meetingTitle: meeting.title });
    log.warn("webhook not sent — the configured URL is not usable", { error: invalid });
    return result;
  }

  const payload = buildWebhookPayload(meeting, new Date().toISOString(), {
    includeTranscript: webhookIncludeTranscript,
  });
  const result = await post(url, JSON.stringify(payload), webhookSecret.trim());
  recordDelivery({ ...result, at: new Date().toISOString(), meetingTitle: meeting.title });
  if (result.ok) log.info("webhook delivered", { meetingId: meeting.id, attempts: result.attempts });
  else log.warn("webhook delivery failed", result);
  return result;
}

/**
 * Send a real, clearly-marked test delivery to the configured URL.
 *
 * A real POST rather than a validity check: what breaks a webhook is a receiver
 * rejecting the body, a proxy in the way, or a signature the far end verifies
 * differently — none of which a URL parser can find.
 */
export async function sendTestDelivery(url: string, secret: string): Promise<DeliveryResult> {
  const invalid = webhookUrlError(url.trim());
  if (invalid) return { ok: false, error: invalid, attempts: 0 };
  const now = new Date().toISOString();
  const payload = buildWebhookPayload(
    {
      id: "test", title: "Ledgeur test delivery", createdAt: now, startedAt: now, endedAt: now,
      lang: "en-hq", wordCount: 0,
      summary: ["This is a test delivery from Ledgeur — no meeting was recorded."],
      decisions: [], questions: [], actionItems: [],
      noteMarkdown: "# Ledgeur test delivery\n\nThis is a test delivery. No meeting was recorded.",
      segments: [],
    },
    now,
  );
  return post(url.trim(), JSON.stringify(payload), secret.trim());
}
