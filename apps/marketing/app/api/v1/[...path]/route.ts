import { authenticateToken } from "@ledgeur/mcp/auth";
import { handleApi } from "@/lib/api-v1/handlers";
import { errorResponse, ApiError } from "@/lib/api-v1/http";
import { SUPABASE } from "@/lib/site";
import { captureServerError } from "@/lib/observability";

// The public Meetings API. See docs/API.md for the contract and
// lib/api-v1/handlers.ts for the implementation.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function env() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? SUPABASE.url;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? SUPABASE.anonKey;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return null;
  return { supabaseUrl, anonKey, serviceRoleKey };
}

async function route(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const configured = env();
  if (!configured) {
    return errorResponse(new ApiError(503, "not_configured", "This deployment is missing SUPABASE_SERVICE_ROLE_KEY, so the API cannot authenticate anybody."));
  }
  const { path } = await ctx.params;
  return handleApi(req, path, {
    authenticate: (token) => authenticateToken(token, configured),
    report: (e, scope) => captureServerError(e, { scope }),
  });
}

export { route as GET, route as POST, route as DELETE };
