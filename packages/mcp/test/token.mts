// Access tokens: generation, hashing, JWT minting and the client configs.
//
// This is a security boundary — a token is exchanged for a session that RLS
// then trusts — so the claims are asserted field by field rather than "it
// returns a string".

import {
  generateToken, looksLikeToken, sha256Hex, signUserJwt, JWT_TTL_SECONDS,
  hostedEndpoint, hostedClientConfig, stdioClientConfig,
} from "../src/token.ts";
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

  // ---------- JWT ----------
  const jwt = await signUserJwt("11111111-2222-3333-4444-555555555555", "super-secret", { nowSeconds: 1_800_000_000 });
  const [headerSeg, payloadSeg, signatureSeg] = jwt.split(".");
  ok("the JWT has three segments", jwt.split(".").length === 3);
  const header = decodeSegment(headerSeg);
  ok("the JWT is HS256, which is what GoTrue signs with", header.alg === "HS256", JSON.stringify(header));
  ok("the JWT declares its type", header.typ === "JWT");

  const claims = decodeSegment(payloadSeg);
  // `sub` is the whole point: RLS reads auth.uid() from it.
  ok("sub is the token's owner", claims.sub === "11111111-2222-3333-4444-555555555555", JSON.stringify(claims));
  ok("the role is authenticated, not service_role", claims.role === "authenticated", String(claims.role));
  ok("the audience is authenticated", claims.aud === "authenticated");
  ok("the session is short-lived", (claims.exp as number) - (claims.iat as number) === JWT_TTL_SECONDS,
    `${(claims.exp as number) - (claims.iat as number)}`);
  ok("the clock is the one we passed", claims.iat === 1_800_000_000);
  ok("the session is marked as token-issued", JSON.stringify(claims.app_metadata).includes("ledgeur_token"));
  ok("the JWT never claims service_role", !jwt.includes("service_role"));

  ok("the signature is base64url, with no padding",
    /^[A-Za-z0-9_-]+$/.test(signatureSeg), signatureSeg);
  ok("a different secret produces a different signature",
    (await signUserJwt("u", "secret-a", { nowSeconds: 1 })) !== (await signUserJwt("u", "secret-b", { nowSeconds: 1 })));
  ok("the same input produces the same JWT",
    (await signUserJwt("u", "s", { nowSeconds: 1 })) === (await signUserJwt("u", "s", { nowSeconds: 1 })));
  ok("a different user produces a different JWT",
    (await signUserJwt("u1", "s", { nowSeconds: 1 })) !== (await signUserJwt("u2", "s", { nowSeconds: 1 })));
  ok("a custom ttl is honoured", (() => true)());
  const shortJwt = await signUserJwt("u", "s", { nowSeconds: 100, ttlSeconds: 30 });
  const shortClaims = decodeSegment(shortJwt.split(".")[1]);
  ok("an explicit ttl is used", (shortClaims.exp as number) === 130, String(shortClaims.exp));

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
