// Notion integration (client side). The Markdown→blocks conversion is done here
// with @parleynotes/core (single source of truth); the token exchange and the
// actual API calls run in edge functions so the Notion secret/token stay server-side.

import { markdownToNotionBlocks } from "@parleynotes/core";
import { getSupabase } from "./supabase.ts";

const NOTION_CLIENT_ID = import.meta.env.VITE_NOTION_CLIENT_ID ?? "";
/** Hosted OAuth callback (a marketing-site page) that returns the code to paste. */
export const NOTION_REDIRECT_URI = import.meta.env.VITE_NOTION_REDIRECT_URI ?? "https://parleynotes.com/oauth/notion";

export function notionConfigured(): boolean {
  return Boolean(NOTION_CLIENT_ID);
}

/** The Notion authorize URL to open in the system browser. */
export function notionAuthUrl(): string {
  if (!NOTION_CLIENT_ID) throw new Error("Notion is not configured (VITE_NOTION_CLIENT_ID).");
  const p = new URLSearchParams({
    client_id: NOTION_CLIENT_ID,
    response_type: "code",
    owner: "user",
    redirect_uri: NOTION_REDIRECT_URI,
  });
  return `https://api.notion.com/v1/oauth/authorize?${p.toString()}`;
}

/** Exchange the authorization code (server-side) and store the connection. */
export async function completeNotionConnect(code: string): Promise<{ workspaceName: string | null }> {
  const sb = getSupabase();
  if (!sb) throw new Error("Sign in first.");
  const { data, error } = await sb.functions.invoke("notion-oauth", {
    body: { code: code.trim(), redirectUri: NOTION_REDIRECT_URI },
  });
  if (error) throw new Error(error.message);
  return { workspaceName: (data as { workspaceName?: string }).workspaceName ?? null };
}

export async function isNotionConnected(): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  const { data } = await sb.from("integrations").select("id").eq("provider", "notion").maybeSingle();
  return Boolean(data);
}

/** Save a meeting's notes to Notion. Returns the created page URL. */
export async function saveMeetingToNotion(title: string, markdown: string): Promise<string> {
  const sb = getSupabase();
  if (!sb) throw new Error("Sign in to save to Notion.");
  const blocks = markdownToNotionBlocks(markdown);
  const { data, error } = await sb.functions.invoke("notion-save", { body: { title, blocks } });
  if (error) throw new Error(error.message);
  const url = (data as { url?: string }).url;
  if (!url) throw new Error("Notion did not return a page URL.");
  return url;
}
