import { LedgeurWebhookError } from "./errors.ts";
import type { LedgeurEvent } from "./types.ts";

// The signing scheme is the one in @ledgeur/core's notes/webhook.ts (which the
// server signs with): HMAC-SHA256 over `${timestamp}.${body}`, hex, sent as
// `sha256=<hex>` in X-Ledgeur-Signature with X-Ledgeur-Timestamp. This package
// has no dependencies, so the few lines are restated here, and test/ checks the
// two against each other.

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

async function sign(secret: string, timestamp: string, body: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return `sha256=${hex(await crypto.subtle.sign("HMAC", key, enc.encode(`${timestamp}.${body}`)))}`;
}

function equal(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

function header(headers: Headers | Record<string, string | string[] | undefined>, name: string): string | null {
  if (typeof (headers as Headers).get === "function") return (headers as Headers).get(name);
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  const v = key ? (headers as Record<string, string | string[] | undefined>)[key] : undefined;
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

export interface VerifyOptions {
  /** How far the timestamp may be from now, either way. Default 300. */
  toleranceSeconds?: number;
  /** Current time in ms. For tests. */
  now?: number;
}

/**
 * Verify a webhook delivery and return its event.
 *
 * Pass the raw request body as text, exactly as received: re-serialising parsed
 * JSON changes the bytes and the signature will not match.
 *
 * @throws LedgeurWebhookError when the signature is missing, wrong or too old.
 */
export async function verifyWebhook(
  rawBody: string,
  headers: Headers | Record<string, string | string[] | undefined>,
  secret: string,
  options: VerifyOptions = {},
): Promise<LedgeurEvent> {
  const timestamp = header(headers, "x-ledgeur-timestamp");
  const signature = header(headers, "x-ledgeur-signature");
  if (!timestamp || !signature) throw new LedgeurWebhookError("malformed", "Missing X-Ledgeur-Timestamp or X-Ledgeur-Signature header.");

  const sent = /^\d+$/.test(timestamp) ? Number(timestamp) * (timestamp.length <= 11 ? 1000 : 1) : Date.parse(timestamp);
  if (!Number.isFinite(sent)) throw new LedgeurWebhookError("malformed", "X-Ledgeur-Timestamp is not a valid time.");
  const tolerance = (options.toleranceSeconds ?? 300) * 1000;
  if (Math.abs((options.now ?? Date.now()) - sent) > tolerance) {
    throw new LedgeurWebhookError("stale", "The delivery timestamp is outside the allowed tolerance.");
  }

  if (!equal(await sign(secret, timestamp, rawBody), signature)) {
    throw new LedgeurWebhookError("bad_signature", "The signature does not match.");
  }

  let event: LedgeurEvent;
  try { event = JSON.parse(rawBody) as LedgeurEvent; } catch { throw new LedgeurWebhookError("bad_body", "The body is not valid JSON."); }
  return event;
}
