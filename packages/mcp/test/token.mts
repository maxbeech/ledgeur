// Access tokens: generation, hashing, JWT minting and the client configs.
//
// This is a security boundary — a token is exchanged for a session that RLS
// then trusts — so the claims are asserted field by field rather than "it
// returns a string".

import {
  generateToken, looksLikeToken, sha256Hex,
  hostedEndpoint, hostedClientConfig, stdioClientConfig,
} from "../src/token.ts";
import { sessionForUser, clearSessions, SessionError } from "../src/session.ts";
import { bearerFrom } from "../src/auth.ts";

function decodeSegment(segment: string): Record<string, unknown> {
  const padded = segment.replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
}

export async function runTokenTests(ok: (name: string, cond: boolean, detail?: string) => void) {
  // ---------- generation ----------
  const a = generateToken();
  const b = generateToken();
  ok("a token is prefixed so it is recognisable in a config file", a.startsWith("ldg_"), a);
  ok("a token carries 256 bits of randomness", a.length === 4 + 64, `${a.length}`);
  ok("two tokens differ", a !== b);
  ok("a generated token passes its own shape check", looksLikeToken(a));
  ok("a token is lowercase hex after the prefix", /^ldg_[0-9a-f]{64}$/.test(a), a);

  ok("an anon key is not mistaken for a token", !looksLikeToken("eyJhbGciOiJIUzI1NiJ9.abc.def"));
  ok("an empty string is not a token", !looksLikeToken(""));
  ok("a truncated token is rejected", !looksLikeToken("ldg_abc"));
  ok("a token with the wrong prefix is rejected", !looksLikeToken(`sk_${"a".repeat(64)}`));
  ok("surrounding whitespace is tolerated", looksLikeToken(`  ${a}  `));

  // ---------- hashing ----------
  const hash = await sha256Hex(a);
  ok("the hash is 64 hex characters", /^[0-9a-f]{64}$/.test(hash), hash);
  ok("hashing is deterministic", (await sha256Hex(a)) === hash);
  ok("different tokens hash differently", (await sha256Hex(b)) !== hash);
  ok("the hash is not the token", !hash.includes(a.slice(4)));
  // A known vector, so a broken crypto shim cannot pass silently.
  ok("sha256 matches a known vector",
    (await sha256Hex("abc")) === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    await sha256Hex("abc"));

  // ---------- establishing a session ----------
  // This does not sign a JWT. The project uses ES256 now, its HS256 key is
  // `previously_used`, and the management API no longer exposes a secret to
  // sign with — so GoTrue is asked for a session instead. Verified against the
  // live project: the result is ES256, `sub` is the user, and RLS scopes it.
  {
    clearSessions();
    const calls: { url: string; body: unknown }[] = [];
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
      if (String(url).includes("generate_link")) {
        return { ok: true, json: async () => ({ hashed_token: "hashed-abc" }) } as unknown as Response;
      }
      return { ok: true, json: async () => ({ access_token: "session-jwt", expires_at: 5_000 }) } as unknown as Response;
    }) as unknown as typeof fetch;

    const env = { supabaseUrl: "https://x.supabase.co", anonKey: "anon", serviceRoleKey: "sr" };
    const token = await sessionForUser("user-1", "a@example.com", env, { fetch: fakeFetch, now: () => 1000 });

    ok("a session is returned", token === "session-jwt", token);
    ok("it asks GoTrue for a link rather than signing anything",
      calls[0].url.includes("/auth/v1/admin/generate_link"), calls[0].url);
    ok("the link is for the token's owner",
      (calls[0].body as { email: string }).email === "a@example.com");
    ok("the link type is a magic link, which is not emailed by generate_link",
      (calls[0].body as { type: string }).type === "magiclink");
    ok("it redeems the token against the verify endpoint",
      calls[1].url.includes("/auth/v1/verify"), calls[1].url);
    // GoTrue rejects a hashed token sent as `token` with "Only an email address
    // or phone number should be provided" — a real failure, found live.
    ok("the hashed token is sent as token_hash, not token",
      (calls[1].body as { token_hash?: string; token?: string }).token_hash === "hashed-abc"
      && (calls[1].body as { token?: string }).token === undefined,
      JSON.stringify(calls[1].body));

    // Two round-trips per tool call would be a poor trade for a server that
    // answers several questions in a row.
    const again = await sessionForUser("user-1", "a@example.com", env, { fetch: fakeFetch, now: () => 1000 });
    ok("a live session is reused rather than re-minted", again === "session-jwt" && calls.length === 2, `${calls.length} calls`);

    // ...but never past its life. Expiry 5000, margin 60: at 4950 it must re-mint.
    await sessionForUser("user-1", "a@example.com", env, { fetch: fakeFetch, now: () => 4_950 });
    ok("a session near expiry is re-minted", calls.length === 4, `${calls.length} calls`);

    clearSessions();
    await sessionForUser("user-1", "a@example.com", env, { fetch: fakeFetch, now: () => 1000 });
    ok("forgetting a session forces a fresh one", calls.length === 6, `${calls.length} calls`);
  }

  {
    clearSessions();
    const failing = (async (url: string) => (String(url).includes("generate_link")
      ? { ok: false, json: async () => ({ msg: "no such user" }) }
      : { ok: true, json: async () => ({}) })) as unknown as typeof fetch;
    let error: unknown;
    await sessionForUser("u", "gone@example.com", { supabaseUrl: "https://x", anonKey: "a", serviceRoleKey: "s" }, { fetch: failing })
      .catch((e) => { error = e; });
    ok("a failure to establish a session is a SessionError", error instanceof SessionError);
    ok("it carries a status the route can use", (error as SessionError).status === 500);
    // The upstream message may name an account; the caller's does not.
    ok("it does not leak the upstream message",
      !/no such user/.test((error as SessionError).message), (error as SessionError).message);
  }

  // ---------- bearer parsing ----------
  ok("a bearer header is read", bearerFrom(`Bearer ${a}`) === a);
  ok("the scheme is case-insensitive, because clients differ", bearerFrom(`bearer ${a}`) === a);
  ok("a missing header is ignored", bearerFrom(null) === null);
  ok("a non-bearer scheme is not mistaken for a token", bearerFrom(`Basic ${a}`) === null);

  // ---------- client configs ----------
  ok("the hosted endpoint is /api/mcp", hostedEndpoint("https://ledgeur.com") === "https://ledgeur.com/api/mcp");
  ok("a trailing slash does not double up", hostedEndpoint("https://ledgeur.com/") === "https://ledgeur.com/api/mcp");

  const hosted = JSON.parse(hostedClientConfig("https://ledgeur.com", a));
  ok("the hosted config declares an http transport", hosted.mcpServers.ledgeur.type === "http");
  ok("the hosted config carries the token as a bearer",
    hosted.mcpServers.ledgeur.headers.Authorization === `Bearer ${a}`);
  ok("the hosted config needs no command to run", hosted.mcpServers.ledgeur.command === undefined);

  const stdio = JSON.parse(stdioClientConfig({ supabaseUrl: "https://x.supabase.co", anonKey: "anon", token: a }));
  ok("the stdio config spawns the published server", String(stdio.mcpServers.ledgeur.args.join(" ")).includes("@ledgeur/mcp-server"));
  ok("the stdio config passes the token by env, not on the command line",
    stdio.mcpServers.ledgeur.env.LEDGEUR_TOKEN === a && !JSON.stringify(stdio.mcpServers.ledgeur.args).includes(a));
  ok("the stdio config never carries a service role key",
    !JSON.stringify(stdio).toLowerCase().includes("service_role"));
}
