import { timingSafeEqual } from "@ledgeur/core";
import { createClient } from "@supabase/supabase-js";
import { runDispatch } from "@/lib/webhooks/dispatch";
import { SUPABASE } from "@/lib/site";
import { captureServerError } from "@/lib/observability";

// Webhook dispatcher, called every minute by a Helm7 scheduled job
// (kind cron, path /api/cron/webhooks). Helm7 sends
// `Authorization: Bearer $CRON_SECRET`; anything else is refused.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function run(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ error: "CRON_SECRET is not set on this deployment." }, { status: 503 });
  const presented = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") ?? "")?.[1] ?? "";
  if (!timingSafeEqual(presented, secret)) return Response.json({ error: "Unauthorized." }, { status: 401 });

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) return Response.json({ error: "SUPABASE_SERVICE_ROLE_KEY is not set." }, { status: 503 });
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? SUPABASE.url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  try {
    const result = await runDispatch({
      admin,
      allowLocalTargets: process.env.WEBHOOKS_ALLOW_LOCAL_TARGETS === "1",
      report: (e, scope) => captureServerError(e, { scope }),
    });
    return Response.json(result);
  } catch (e) {
    captureServerError(e, { scope: "webhooks.dispatch" });
    return Response.json({ error: "Dispatch failed." }, { status: 500 });
  }
}

export { run as GET, run as POST };
