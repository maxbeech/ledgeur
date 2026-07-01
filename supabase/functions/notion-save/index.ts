// Save a meeting's notes to Notion. The client converts note Markdown to Notion
// blocks with @parleynotes/core (single source of truth) and posts them here; we
// attach the user's server-stored Notion token and create the page. Keeping the
// token server-side means it never touches the device.

import { createClient } from "npm:@supabase/supabase-js@2";
import { json, preflight } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  const { title, blocks } = await req.json().catch(() => ({}));
  if (!title || !Array.isArray(blocks)) return json({ error: "title and blocks[] are required" }, 400);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await anon.auth.getUser();
  if (userErr || !userData.user) return json({ error: "Not authenticated" }, 401);

  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: integ } = await admin
    .from("integrations")
    .select("id, external_account_id, config")
    .eq("user_id", userData.user.id).eq("provider", "notion").maybeSingle();
  if (!integ) return json({ error: "Notion is not connected." }, 400);

  const { data: secret } = await admin
    .from("integration_secrets").select("access_token").eq("integration_id", integ.id).maybeSingle();
  if (!secret?.access_token) return json({ error: "Notion token missing — reconnect Notion." }, 400);

  const databaseId = (integ.config as { database_id?: string })?.database_id;
  const parent = databaseId
    ? { type: "database_id", database_id: databaseId }
    : { type: "workspace", workspace: true };

  const first = blocks.slice(0, 100);
  const rest = blocks.slice(100);
  const pageRes = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: { Authorization: `Bearer ${secret.access_token}`, "Content-Type": "application/json", "Notion-Version": "2022-06-28" },
    body: JSON.stringify({
      parent,
      properties: { title: { title: [{ type: "text", text: { content: String(title).slice(0, 2000) } }] } },
      children: first,
    }),
  });
  const page = await pageRes.json();
  if (!pageRes.ok) return json({ error: `Notion: ${page.message ?? pageRes.status}` }, 400);

  // Append overflow blocks in 100-block chunks.
  for (let i = 0; i < rest.length; i += 100) {
    await fetch(`https://api.notion.com/v1/blocks/${page.id}/children`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${secret.access_token}`, "Content-Type": "application/json", "Notion-Version": "2022-06-28" },
      body: JSON.stringify({ children: rest.slice(i, i + 100) }),
    });
  }

  return json({ ok: true, url: page.url ?? null });
});
