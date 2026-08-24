// Agent access from the app — the paid data tier.
//
// The token itself is minted by the shared helper in @ledgeur/mcp, so the app
// and the website issue the same kind of credential through the same endpoint.
// This file only decides what to *show*: a paste-ready config for whichever
// transport the user's MCP client speaks.

import {
  issueAccessToken, hostedClientConfig, stdioClientConfig,
} from "@ledgeur/mcp";
import { getSupabase } from "./supabase.ts";
import { CONFIG } from "./config.ts";

export interface McpConfigResult {
  paid: boolean;
  /** The plaintext token — returned once, never recoverable. */
  token?: string;
  /** Paste-ready config for a client that speaks HTTP (preferred: no process). */
  hosted?: string;
  /** Paste-ready config for a client that spawns a process. */
  stdio?: string;
}

/** Where the hosted endpoint lives. Overridable so a self-hoster can point the
 *  app at their own deployment rather than ours. */
const siteUrl = () => (import.meta.env.VITE_SITE_URL as string | undefined) ?? "https://ledgeur.com";

export async function generateMcpConfig(): Promise<McpConfigResult> {
  const sb = getSupabase();
  if (!sb) throw new Error("Sign in first.");

  const result = await issueAccessToken(sb, "App-issued token");
  if (!result.ok) {
    if (result.reason === "upgrade_required") return { paid: false };
    throw new Error(result.message);
  }

  return {
    paid: true,
    token: result.token,
    hosted: hostedClientConfig(siteUrl(), result.token),
    stdio: stdioClientConfig({
      supabaseUrl: CONFIG.supabaseUrl,
      anonKey: CONFIG.supabaseAnonKey,
      token: result.token,
    }),
  };
}
