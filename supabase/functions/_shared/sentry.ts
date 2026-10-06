// Minimal Sentry reporter for Supabase edge functions (Deno). The full SDK is
// not worth bundling for a handful of webhook failure sites, so this posts one
// error event to the project's envelope endpoint. Set the SENTRY_DSN function
// secret to the ledgeur_web DSN; without it the failure is only logged, loudly.

export async function captureEdgeError(err: unknown, context: Record<string, unknown> = {}): Promise<void> {
  const dsn = Deno.env.get("SENTRY_DSN");
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : JSON.stringify(err);
  if (!dsn) {
    console.error("Sentry not configured (SENTRY_DSN missing); unreported failure:", message, context);
    return;
  }
  try {
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
      tags: { scope: String(context.scope ?? "edge-function") },
      extra: context,
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
    console.error("Could not reach Sentry", e);
  }
}
