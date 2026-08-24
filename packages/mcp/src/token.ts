// Ledgeur access tokens: minting them, hashing them, and turning one back into
// a database session that speaks as its owner.
//
// ── Why this file exists ────────────────────────────────────────────────────
// The schema for `mcp_tokens` says: "sha-256 of the issued token; the plaintext
// is shown once and never stored". That is the right design — an opaque secret
// we cannot recover, revocable by deleting a row.
//
// The first implementation of the hosted endpoint, though, assumed the token
// was the user's Supabase *refresh* token and called `refreshSession` with it.
// Those two designs are incompatible, and the consequence was that every token
// the app issued was dead on arrival: the mint recorded the hash of a random
// string, and the endpoint then looked up the hash of a refresh token, which
// was never in the table. Worse, had they matched, GoTrue rotates refresh
// tokens on use, so a long-lived token would have worked exactly once.
//
// So a token is now an opaque random string, and it is exchanged for a
// short-lived Supabase JWT signed with the project's own secret. Row-level
// security sees an ordinary authenticated user, `auth.uid()` is the token's
// owner, and the endpoint holds no standing authority of its own.

const TOKEN_BYTES = 32;
const TOKEN_PREFIX = "ldg_";

/** Hex-encoded SHA-256. The one thing we store. */
export async function sha256Hex(value: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * A fresh access token.
 *
 * Prefixed so it is recognisable in a config file and greppable in a leak
 * scanner, and 256 bits of randomness after that.
 */
export function generateToken(): string {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  const body = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${TOKEN_PREFIX}${body}`;
}

/** Shape check before spending a database round-trip on obvious rubbish. */
export function looksLikeToken(value: string): boolean {
  return new RegExp(`^${TOKEN_PREFIX}[0-9a-f]{${TOKEN_BYTES * 2}}$`).test(value.trim());
}

/* ----------------------------------------------------------- JWT minting */

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const encodeJson = (value: unknown) => base64url(new TextEncoder().encode(JSON.stringify(value)));

/** How long a minted session lives. Short: it is created per request, and a
 *  leaked one should stop being useful almost immediately. */
export const JWT_TTL_SECONDS = 300;

/**
 * Sign a Supabase-compatible user JWT (HS256) with the project's JWT secret.
 *
 * These are exactly the claims GoTrue issues, so PostgREST accepts it and
 * `auth.uid()` resolves to `sub` — meaning every RLS policy already written
 * applies unchanged. The alternative, querying with the service role and
 * filtering by hand, would put the security model in application code where a
 * single missed `.eq()` leaks another organisation's meetings.
 *
 * @param nowSeconds injectable for tests; defaults to the real clock.
 */
export async function signUserJwt(
  userId: string,
  jwtSecret: string,
  options: { ttlSeconds?: number; nowSeconds?: number } = {},
): Promise<string> {
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const ttl = options.ttlSeconds ?? JWT_TTL_SECONDS;

  const header = encodeJson({ alg: "HS256", typ: "JWT" });
  const payload = encodeJson({
    sub: userId,
    role: "authenticated",
    aud: "authenticated",
    iat: now,
    exp: now + ttl,
    // Marks where this session came from, so a token-issued request is
    // distinguishable in logs from a person signing in.
    app_metadata: { provider: "ledgeur_token" },
  });

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(jwtSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${header}.${payload}`),
  );
  return `${header}.${payload}.${base64url(new Uint8Array(signature))}`;
}

/* ------------------------------------------------------ client-side config */

/** Where the hosted endpoint lives, given a site origin. */
export const hostedEndpoint = (siteUrl: string) => `${siteUrl.replace(/\/$/, "")}/api/mcp`;

/**
 * Config for an MCP client that speaks HTTP — the hosted endpoint. This is the
 * one to prefer: it needs no process, no checkout, and no Node on the machine.
 */
export function hostedClientConfig(siteUrl: string, token: string): string {
  return JSON.stringify(
    { mcpServers: { ledgeur: { type: "http", url: hostedEndpoint(siteUrl), headers: { Authorization: `Bearer ${token}` } } } },
    null,
    2,
  );
}

/**
 * Config for an MCP client that spawns a process — Claude Desktop's classic
 * stdio transport. Kept because some clients still cannot speak HTTP.
 */
export function stdioClientConfig(opts: {
  supabaseUrl: string;
  anonKey: string;
  token: string;
}): string {
  return JSON.stringify(
    {
      mcpServers: {
        ledgeur: {
          command: "npx",
          args: ["-y", "@ledgeur/mcp-server"],
          env: {
            LEDGEUR_SUPABASE_URL: opts.supabaseUrl,
            LEDGEUR_SUPABASE_ANON_KEY: opts.anonKey,
            LEDGEUR_TOKEN: opts.token,
          },
        },
      },
    },
    null,
    2,
  );
}
