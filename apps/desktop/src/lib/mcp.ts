// Generate the MCP client config (the paid data tier). Plan-gated: free orgs get
// an explicit upgrade signal; paid orgs get a ready-to-paste config that points
// an MCP client at the Ledgeur server, authenticated as this user.

import type { Session } from "@supabase/supabase-js";
import { getSupabase } from "./supabase.ts";
import { CONFIG } from "./config.ts";

export interface McpConfigResult {
  paid: boolean;
  /** Ready-to-paste MCP client config JSON (present only when paid). */
  config?: string;
}

export async function generateMcpConfig(session: Session): Promise<McpConfigResult> {
  const sb = getSupabase();
  if (!sb) throw new Error("Sign in first.");

  const { data: org, error } = await sb.from("orgs").select("id, plan").limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  if (!org) throw new Error("No organisation found for your account.");
  if (org.plan === "free") return { paid: false };

  // Server-side re-check + issuance audit (enforces the gate authoritatively).
  const { error: mintErr } = await sb.functions.invoke("mcp-token", { body: { name: "Desktop-issued token" } });
  if (mintErr) throw new Error(mintErr.message);

  const config = JSON.stringify(
    {
      mcpServers: {
        ledgeur: {
          command: "pnpm",
          args: ["--filter", "@ledgeur/mcp-server", "start"],
          env: {
            LEDGEUR_SUPABASE_URL: CONFIG.supabaseUrl,
            LEDGEUR_SUPABASE_ANON_KEY: CONFIG.supabaseAnonKey,
            LEDGEUR_REFRESH_TOKEN: session.refresh_token,
          },
        },
      },
    },
    null,
    2,
  );
  return { paid: true, config };
}
