// Minimal Sentry reporter for Supabase edge functions (Deno). The full SDK is
// not worth bundling for a handful of webhook failure sites, so this posts one
// error event to the project's envelope endpoint. Set the SENTRY_DSN function
// secret to the ledgeur_web DSN; without it the failure is only logged, loudly.
//
// Context is ids, codes and counts only (`safeContext` omits anything else), the
// message is scrubbed, and a scrub failure drops the event rather than sending
// it raw. Never put a database/Stripe error message in the Error: pass its code.

import { safeContext, scrubText } from "./scrub.ts";

export async function captureEdgeError(err: unknown, context: Record<string, unknown> = {}): Promise<void> {
  const dsn = Deno.env.get("SENTRY_DSN");
  const rawMessage = err instanceof Error ? err.message : typeof err === "string" ? err : "non-error value thrown";
  if (!dsn) {
    console.error("Sentry not configured (SENTRY_DSN missing); unreported failure:", rawMessage, safeContext(context));
    return;
  }
  try {
    const message = scrubText(rawMessage);
    const safe = safeContext(context);
    const u = new URL(dsn);
    const projectId = u.pathname.replace("/", "");
    const eventId = crypto.randomUUID().replaceAll("-", "");
    const event = {
      event_id: eventId,
      timestamp: Date.now() / 1000,
      platform: "javascript",
      level: "error",
      environment: "production",
      server_name: "supabase-edge",
      tags: { scope: String(safe.scope ?? "edge-function") },
      extra: safe,
      exception: { values: [{ type: err instanceof Error ? err.name : "Error", value: message }] },
    };
    const body = [
      JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString(), dsn }),
      JSON.stringify({ type: "event" }),
      JSON.stringify(event),
    ].join("\n");
    const res = await fetch(`${u.protocol}//${u.host}/api/${projectId}/envelope/?sentry_key=${u.username}&sentry_version=7`, {
      method: "POST",
      headers: { "Content-Type": "application/x-sentry-envelope" },
      body,
    });
    if (!res.ok) console.error("Sentry rejected the event", res.status);
  } catch (e) {
    // Fail closed: nothing was sent, and the error text is not echoed (it may quote the payload).
    console.error("Could not report to Sentry", e instanceof Error ? e.name : "unknown");
  }
}
