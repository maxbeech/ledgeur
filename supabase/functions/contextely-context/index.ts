// Pull Contextely context for an Ask question. Contextely is the company's
// knowledge base; a key acts as one person and searches only what that person can
// see inside Contextely, so this never returns anything they couldn't read there.
// `search` finds the records, then `record_get` reads the top few in full; each block
// is headed by the record's title so an answer can cite it. Same non-fatal shape as
// notion-context: no connection, no key, or a Contextely error just means no
// Contextely context, never a broken Ask.

import { createClient } from "npm:@supabase/supabase-js@2";
import { json, preflight } from "../_shared/cors.ts";
import { contextelyBaseUrl, searchContext } from "../_shared/contextely.ts";

const BASE_URL = contextelyBaseUrl(Deno.env.get("CONTEXTELY_BASE_URL"));

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

  let blocks;
  try {
    blocks = await searchContext(BASE_URL, secret.access_token, query);
  } catch {
    return json({ ok: true, blocks: [] }); // Contextely unreachable or erroring — non-fatal for Ask
  }

  return json({ ok: true, blocks });
});
