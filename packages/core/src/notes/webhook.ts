// Outbound webhooks: telling another system a meeting finished.
//
// The point is to let Ledgeur end at the edge of Ledgeur — a finished meeting
// posts to Zapier, n8n, a Slack relay, an internal CRM, and the notes land
// wherever that team already works. This module owns the *contract*: what the
// payload contains, how it is signed, and what counts as delivered. The actual
// fetch belongs to the app, which knows about settings and retries.
//
// ── Privacy ─────────────────────────────────────────────────────────────────
// A webhook is the first thing in Ledgeur that deliberately sends a meeting off
// the device, so what it sends is deliberately narrow and explicitly chosen:
// notes and metadata by default, and the full transcript only when the user
// asks for it. Voice embeddings are never included under any setting — they
// identify a person biometrically and no integration needs them.
//
// ── Signing ─────────────────────────────────────────────────────────────────
// HMAC-SHA256 over the exact bytes sent, in the `X-Ledgeur-Signature` header as
// `sha256=<hex>`, with the timestamp in `X-Ledgeur-Timestamp` and included in
// the signed string — the shape GitHub and Stripe use, so a receiver can verify
// it with code they have already written. The timestamp is signed so a captured
// delivery cannot be replayed indefinitely.

export interface WebhookMeeting {
  id: string;
  title: string;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  lang: string;
  wordCount: number;
  summary: string[];
  decisions: string[];
  questions: string[];
  actionItems: string[];
  manualNotes?: string;
  noteMarkdown: string;
  speakers?: { label: string; speakingSeconds: number }[];
  segments?: { speakerLabel: string; startMs: number; endMs: number; text: string }[];
}

export interface WebhookPayload {
  /** Contract version. Present from the first delivery so a receiver can
   *  branch on it later without guessing. */
  version: 1;
  event: "meeting.completed";
  /** ISO 8601, also sent in the header and covered by the signature. */
  sentAt: string;
  meeting: WebhookMeeting;
}

export interface WebhookOptions {
  /** Include the full speaker-labelled transcript. Off by default. */
  includeTranscript?: boolean;
}

/** Build the payload from a saved meeting. Pure — unit-tested. */
export function buildWebhookPayload(
  meeting: {
    id: string; title: string; createdAt: string; startedAt: string | null; endedAt: string | null;
    lang: string; wordCount: number; summary: string[]; decisions: string[]; questions: string[];
    actionItems: string[]; manualNotes?: string; noteMarkdown: string;
    speakers?: { label: string; speakingSeconds: number; embedding?: number[] }[];
    segments: { speakerLabel: string; startMs: number; endMs: number; text: string }[];
  },
  sentAt: string,
  options: WebhookOptions = {},
): WebhookPayload {
  return {
    version: 1,
    event: "meeting.completed",
    sentAt,
    meeting: {
      id: meeting.id,
      title: meeting.title,
      createdAt: meeting.createdAt,
      startedAt: meeting.startedAt,
      endedAt: meeting.endedAt,
      lang: meeting.lang,
      wordCount: meeting.wordCount,
      summary: meeting.summary,
      decisions: meeting.decisions,
      questions: meeting.questions,
      actionItems: meeting.actionItems,
      manualNotes: meeting.manualNotes,
      noteMarkdown: meeting.noteMarkdown,
      // Labels and speaking time only. The `embedding` is dropped here rather
      // than at the call site so no caller can forget: it is a voiceprint.
      speakers: meeting.speakers?.map((s) => ({ label: s.label, speakingSeconds: s.speakingSeconds })),
      segments: options.includeTranscript
        ? meeting.segments.map((s) => ({
            speakerLabel: s.speakerLabel, startMs: s.startMs, endMs: s.endMs, text: s.text,
          }))
        : undefined,
    },
  };
}

/** The exact string the signature covers: `<timestamp>.<body>`. */
export function signingString(timestamp: string, body: string): string {
  return `${timestamp}.${body}`;
}

/** HMAC-SHA256 hex, via WebCrypto (browser, worker, Deno and Node 18+). */
export async function signWebhook(secret: string, timestamp: string, body: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(signingString(timestamp, body)));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `sha256=${hex}`;
}

/** Headers for a delivery. Signature headers are omitted, not empty, when no
 *  secret is configured — an empty signature header reads as a bug at the
 *  receiver, where a missing one reads as "unsigned", which is the truth. */
export async function webhookHeaders(
  body: string,
  timestamp: string,
  secret?: string,
): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "Ledgeur/1 (+https://www.ledgeur.com)",
    "X-Ledgeur-Event": "meeting.completed",
    "X-Ledgeur-Timestamp": timestamp,
  };
  if (secret) headers["X-Ledgeur-Signature"] = await signWebhook(secret, timestamp, body);
  return headers;
}

/**
 * Why a webhook URL is not acceptable, or null.
 *
 * `http:` is refused outright: the payload is a meeting, and sending one in
 * clear text over the network is not a trade-off a checkbox should be able to
 * make. Localhost is the exception, where there is no network to sniff and
 * where every webhook is tested before it is pointed at anything real.
 */
export function webhookUrlError(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "That isn't a valid URL.";
  }
  const local = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]";
  if (parsed.protocol === "http:" && !local) return "Use an https:// URL — meeting notes shouldn't travel in clear text.";
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "Webhooks have to be http(s).";
  return null;
}
