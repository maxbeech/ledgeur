// Pull Contextely context for an Ask question. Contextely is the shared
// company-memory layer — Notion, Drive, Postgres and anything else the org
// has connected there, condensed and searched under the connecting member's
// own entitlement, so this never returns anything that member couldn't see
// inside Contextely itself. Same non-fatal shape as notion-context: no
// connection, no key, or a Contextely error just means no Contextely context,
// never a broken Ask.

import { createClient } from "npm:@supabase/supabase-js@2";
import { json, preflight } from "../_shared/cors.ts";

const BASE_URL = (Deno.env.get("CONTEXTELY_BASE_URL") ?? "https://www.contextely.com/api/v1").replace(/\/+$/, "");

interface SearchHit {
  title?: string;
  summary?: string;
  source_name?: string;
  freshness?: { state?: string };
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  const { query } = await req.json().catch(() => ({}));
  if (!query || typeof query !== "string") return json({ error: "query is required" }, 400);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await anon.auth.getUser();
  if (userErr || !userData.user) return json({ error: "Not authenticated" }, 401);

  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: integ } = await admin
    .from("integrations")
    .select("id")
    .eq("user_id", userData.user.id).eq("provider", "contextely").maybeSingle();
  if (!integ) return json({ ok: true, blocks: [] }); // not connected — non-fatal

  const { data: secret } = await admin
    .from("integration_secrets").select("access_token").eq("integration_id", integ.id).maybeSingle();
  if (!secret?.access_token) return json({ ok: true, blocks: [] }); // key missing — non-fatal

  let searchRes: Response;
  try {
    searchRes = await fetch(`${BASE_URL}/search`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, limit: 6 }),
    });
  } catch {
    return json({ ok: true, blocks: [] }); // Contextely unreachable — non-fatal for Ask
  }
  if (!searchRes.ok) return json({ ok: true, blocks: [] }); // Contextely error — non-fatal for Ask

  const found = (await searchRes.json()) as { results?: SearchHit[] };
  const blocks = (found.results ?? [])
    .filter((hit) => hit.summary)
    .map((hit) => {
      const stale = hit.freshness?.state && hit.freshness.state !== "fresh";
      const label = hit.source_name ? `${hit.title ?? "Untitled"} — ${hit.source_name}` : hit.title ?? "Untitled";
      return {
        source: `Contextely: ${label}`,
        text: stale ? `${hit.summary} (may be out of date — Contextely could not refresh it)` : hit.summary!,
      };
    });

  return json({ ok: true, blocks });
});
