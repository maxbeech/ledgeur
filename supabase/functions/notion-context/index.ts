// Pull Notion context for an Ask question. Searches the user's connected
// Notion workspace and returns plain-text snippets from matching pages. The
// token never leaves the server — same pattern as notion-save/notion-oauth.
//
// Note: Notion's /v1/search is primarily title-matching, not full-text search,
// so results are a best-effort "which pages look relevant by name", not a true
// semantic search over page content.

import { createClient } from "npm:@supabase/supabase-js@2";
import { json, preflight } from "../_shared/cors.ts";

interface NotionBlock {
  id: string;
  type: string;
  [key: string]: unknown;
}
interface RichText { plain_text: string }

function plainText(rich: RichText[] | undefined): string {
  return (rich ?? []).map((r) => r.plain_text).join("");
}

function pageTitle(page: { properties?: Record<string, { type: string; title?: RichText[] }> }): string {
  const props = page.properties ?? {};
  const titleProp = Object.values(props).find((p) => p.type === "title");
  return titleProp ? plainText(titleProp.title) || "Untitled" : "Untitled";
}

async function pageSnippet(pageId: string, token: string): Promise<string> {
  const res = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children?page_size=25`, {
    headers: { Authorization: `Bearer ${token}`, "Notion-Version": "2022-06-28" },
  });
  if (!res.ok) return "";
  const data = (await res.json()) as { results?: NotionBlock[] };
  const lines = (data.results ?? [])
    .map((b) => plainText((b[b.type] as { rich_text?: RichText[] } | undefined)?.rich_text))
    .filter(Boolean);
  return lines.join("\n").slice(0, 1200);
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
    .eq("user_id", userData.user.id).eq("provider", "notion").maybeSingle();
  if (!integ) return json({ ok: true, blocks: [] }); // not connected — non-fatal

  const { data: secret } = await admin
    .from("integration_secrets").select("access_token").eq("integration_id", integ.id).maybeSingle();
  if (!secret?.access_token) return json({ ok: true, blocks: [] }); // token missing — non-fatal
  const token = secret.access_token;

  const searchRes = await fetch("https://api.notion.com/v1/search", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Notion-Version": "2022-06-28" },
    body: JSON.stringify({ query, filter: { property: "object", value: "page" }, page_size: 5 }),
  });
  if (!searchRes.ok) return json({ ok: true, blocks: [] }); // Notion error — non-fatal for Ask
  const found = (await searchRes.json()) as { results?: Array<{ id: string; url?: string; properties?: Record<string, { type: string; title?: RichText[] }> }> };

  const blocks = (
    await Promise.all(
      (found.results ?? []).map(async (page) => {
        try {
          const text = await pageSnippet(page.id, token);
          if (!text) return null;
          return { source: `Notion: ${pageTitle(page)}`, text };
        } catch {
          return null;
        }
      }),
    )
  ).filter((b): b is { source: string; text: string } => b !== null);

  return json({ ok: true, blocks });
});
