import { NextResponse } from "next/server";
import { McpAuthError, bearerFrom, clientForToken, handleBody } from "@ledgeur/mcp";
import { SUPABASE } from "@/lib/site";

// The hosted MCP endpoint: Ledgeur's paid tier, reachable by a remote client.
//
// The stdio server in apps/mcp-server is what Claude Desktop and Cursor speak
// to, and it runs on the user's own machine. This is for everything that
// cannot spawn a process: a hosted agent, another product's connector, a
// script. Both expose the SAME tools, from packages/mcp, because a tool that
// exists over one transport and not the other is a bug nobody notices until
// somebody switches.
//
// Authentication is the token the app already issues under Integrations, Data
// access. It resolves to a Supabase session for the person who created it, so
// every query below runs under their row level security and this route has no
// privileges of its own.
//
// Node runtime, not Edge: the Supabase client and the token exchange both want
// Node APIs.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function env() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? SUPABASE.url;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? SUPABASE.anonKey;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  // The JWT secret is what lets a token be exchanged for a real user session,
  // so RLS — not this route — decides what an agent can read.
  const jwtSecret = process.env.SUPABASE_JWT_SECRET;
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !jwtSecret) return null;
  return { supabaseUrl, anonKey, serviceRoleKey, jwtSecret };
}

export async function POST(req: Request) {
  const configured = env();
  if (!configured) {
    // Says which half is missing rather than 500ing, because this is the first
    // thing anybody hits on a fresh deployment.
    return NextResponse.json(
      { error: "This deployment is missing SUPABASE_SERVICE_ROLE_KEY or SUPABASE_JWT_SECRET, so the MCP endpoint cannot authenticate anybody." },
      { status: 503 },
    );
  }

  const token = bearerFrom(req.headers.get("authorization"));
  if (!token) {
    return NextResponse.json(
      { error: "Send your Ledgeur access token as an Authorization: Bearer header. Generate one under Account, Agent access." },
      { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="ledgeur"' } },
    );
  }

  let db;
  try {
    db = await clientForToken(token, configured);
  } catch (e) {
    if (e instanceof McpAuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error." } });
  }

  const answer = await handleBody(body, db);
  // A notification gets no body. 202 is what says "received, nothing to say".
  if (answer === null) return new NextResponse(null, { status: 202 });
  return NextResponse.json(answer);
}

// The Streamable HTTP spec allows a GET for a server-initiated SSE stream. This
// endpoint has nothing to push, so it declines rather than holding a connection
// open that a serverless function would drop anyway.
export async function GET() {
  return new NextResponse("This endpoint speaks JSON-RPC over POST. It has no server-initiated stream.", {
    status: 405,
    headers: { Allow: "POST" },
  });
}
