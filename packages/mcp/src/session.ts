// Turning a user id into a real Supabase session, without the project's JWT
// secret.
//
// ── Why not just sign one? ──────────────────────────────────────────────────
// The first version of this minted an HS256 JWT with `SUPABASE_JWT_SECRET`.
// That is a documented pattern, and for this project it does not work:
//
//   • The project has migrated to asymmetric signing. Its in-use key is ES256;
//     the HS256 key is marked `previously_used`. Signing with the legacy secret
//     would depend on a key that is on its way out.
//   • The management API does not expose a JWT secret at all any more, so the
//     value could not be obtained even to try.
//
// So instead of forging a session, we ask GoTrue for one. `generate_link`
// produces a single-use token for a user (it returns the link; it does not send
// an email), and redeeming it is an ordinary sign-in. The result is a genuine
// session signed with whatever key the project currently uses, which means it
// keeps working through key rotation and needs one fewer secret in production.
//
// Verified against the live project: `sub` is the user, `role` is
// `authenticated`, the token is ES256, and row-level security scopes queries to
// exactly that user's rows.

export interface SessionEnv {
  supabaseUrl: string;
  anonKey: string;
  serviceRoleKey: string;
}

export interface MintedSession {
  accessToken: string;
  /** Unix seconds. */
  expiresAt: number;
}

/**
 * Sessions already minted, keyed by user id.
 *
 * Two network round-trips per MCP call would be a poor trade for a server whose
 * job is answering a handful of questions in a row. Serverless instances are
 * reused (Fluid Compute), so this is worth having; when it misses, the only
 * cost is the two calls that would have happened anyway.
 */
const cache = new Map<string, MintedSession>();

/** Re-mint this long before expiry, so a session cannot lapse mid-request. */
const REFRESH_MARGIN_SECONDS = 60;

/** Injectable for tests. */
export interface SessionDeps {
  fetch?: typeof globalThis.fetch;
  now?: () => number;
}

export class SessionError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "SessionError";
  }
}

/**
 * A session belonging to `email`, cached until shortly before it expires.
 *
 * `userId` is the cache key rather than the email, because an address can be
 * changed and a stale entry would then belong to the wrong identity.
 */
export async function sessionForUser(
  userId: string,
  email: string,
  env: SessionEnv,
  deps: SessionDeps = {},
): Promise<string> {
  const doFetch = deps.fetch ?? globalThis.fetch;
  const now = deps.now ?? (() => Math.floor(Date.now() / 1000));

  const cached = cache.get(userId);
  if (cached && cached.expiresAt - REFRESH_MARGIN_SECONDS > now()) return cached.accessToken;

  // A single-use token for this user. This does not send an email.
  const linkRes = await doFetch(`${env.supabaseUrl}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: {
      apikey: env.serviceRoleKey,
      Authorization: `Bearer ${env.serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ type: "magiclink", email }),
  });
  const link = await linkRes.json().catch(() => ({}));
  const hashedToken = (link as { hashed_token?: string }).hashed_token;
  if (!linkRes.ok || !hashedToken) {
    throw new SessionError("Could not establish a session for that token's owner.", 500);
  }

  // Redeeming it is an ordinary sign-in, so it runs under the anon key.
  const verifyRes = await doFetch(`${env.supabaseUrl}/auth/v1/verify`, {
    method: "POST",
    headers: { apikey: env.anonKey, "Content-Type": "application/json" },
    // `token_hash`, not `token`: GoTrue rejects a hashed token sent as `token`
    // with "Only an email address or phone number should be provided".
    body: JSON.stringify({ type: "magiclink", token_hash: hashedToken }),
  });
  const session = await verifyRes.json().catch(() => ({}));
  const accessToken = (session as { access_token?: string }).access_token;
  const expiresAt = (session as { expires_at?: number }).expires_at;
  if (!verifyRes.ok || !accessToken) {
    throw new SessionError("Could not establish a session for that token's owner.", 500);
  }

  cache.set(userId, { accessToken, expiresAt: expiresAt ?? now() + 3600 });
  return accessToken;
}

/** Drop a cached session — used when a token is revoked, and by tests. */
export function forgetSession(userId: string): void {
  cache.delete(userId);
}

/** Empty the cache. Tests only. */
export function clearSessions(): void {
  cache.clear();
}
