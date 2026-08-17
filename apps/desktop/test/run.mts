// Desktop app pure-logic tests. Run: pnpm --filter @ledgeur/desktop test
// Only import modules free of browser-only globals (no import.meta.env, DOM).
import { mergeThread, quoteOf, messageToItem, type ThreadItem } from "../src/lib/thread.ts";
import { parseAiNotes } from "../src/lib/notes.ts";
import {
  authErrorMessage, hasNoAuthMethod, NO_AUTH, parseAuthSettings, providerUnavailableMessage,
  signUpNextStep, validateCredentials,
} from "../src/lib/authMessages.ts";
import type { LocalSegment, ChatMessage } from "../src/lib/meetingsStore.ts";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.error(`  FAIL ${name} ${detail}`); }
};

// --- mergeThread ---
const seg = (id: string, startMs: number, text: string): LocalSegment => ({
  id, speakerLabel: "Speaker 1", startMs, endMs: startMs + 500, text, confidence: 0.9,
});
const msg = (id: string, role: ChatMessage["role"], atMs: number, text: string): ChatMessage => ({ id, role, atMs, text });

const segs = [seg("s1", 0, "hello"), seg("s2", 2000, "world")];
const msgs = [msg("m1", "user", 1000, "who said that?"), msg("m2", "assistant", 1500, "you did")];
const merged = mergeThread(segs, msgs);
ok("mergeThread orders by time", merged.map((i) => i.id).join(",") === "s1,m1,m2,s2", merged.map((i) => i.id).join(","));
ok("mergeThread keeps transcript kind", merged[0].kind === "transcript");
ok("mergeThread maps message role to kind", merged[1].kind === "user" && merged[2].kind === "assistant");
ok("ties keep transcript before message", (() => {
  const m = mergeThread([seg("s", 1000, "x")], [msg("m", "user", 1000, "y")]);
  return m[0].id === "s" && m[1].id === "m";
})());
ok("empty inputs → empty thread", mergeThread([], []).length === 0);

// --- quoteOf / messageToItem ---
const t: ThreadItem = merged[0];
ok("quoteOf transcript uses speaker label", quoteOf(t).label === "Speaker 1");
ok("quoteOf user is You", quoteOf({ kind: "user", id: "u", atMs: 0, text: "hi" }).label === "You");
ok("quoteOf suggestion is Suggestion", quoteOf({ kind: "suggestion", id: "s", atMs: 0, text: "try this" }).label === "Suggestion");
ok("messageToItem preserves quote", (() => {
  const item = messageToItem({ id: "m", role: "user", atMs: 5, text: "hey", quote: { text: "q", label: "You" } });
  return item.kind === "user" && item.quote?.text === "q" && item.atMs === 5;
})());

// --- parseAiNotes ---
const good = JSON.stringify({
  summary: ["Shipped pricing page", "Copy due Friday"],
  actionItems: ["Max — write copy by Friday", ""],
  decisions: ["Ship next week"],
  questions: ["Update the docs?"],
});
const parsed = parseAiNotes(`Here are the notes:\n${good}\nDone.`, "one two three four");
ok("parseAiNotes extracts summary", parsed.summary.length === 2);
ok("parseAiNotes drops empty strings", parsed.actionItems.length === 1 && parsed.actionItems[0].startsWith("Max"));
ok("parseAiNotes counts words from transcript", parsed.wordCount === 4);
ok("parseAiNotes throws on non-JSON", (() => { try { parseAiNotes("no json here", "x"); return false; } catch { return true; } })());
ok("parseAiNotes throws on empty summary", (() => {
  try { parseAiNotes(JSON.stringify({ summary: [] }), "x"); return false; } catch { return true; }
})());

// --- auth capabilities & messages ---
// The app must never offer a sign-in button the backend cannot honour: the
// production Supabase project has google/azure OFF and email ON, and the old UI
// showed Google/Microsoft buttons that failed with a raw redirect error.
const LIVE_SETTINGS = {
  external: { google: false, azure: false, github: false, email: true, phone: false },
  disable_signup: false,
  mailer_autoconfirm: false,
};
const live = parseAuthSettings(LIVE_SETTINGS);
ok("parses email auth as available", live.email === true);
ok("does not offer providers the backend has switched off", live.providers.length === 0, JSON.stringify(live.providers));
ok("signups allowed unless explicitly disabled", live.signupsAllowed === true);
ok("confirmation required when mailer_autoconfirm is false", live.autoConfirm === false);
ok("a live email backend counts as a usable auth method", hasNoAuthMethod(live) === false);

const bothOn = parseAuthSettings({ external: { google: true, azure: true, email: true }, mailer_autoconfirm: true });
ok("offers exactly the providers that are enabled", bothOn.providers.join(",") === "google,azure", bothOn.providers.join(","));
ok("autoConfirm reflected", bothOn.autoConfirm === true);
ok("unknown providers are ignored", parseAuthSettings({ external: { github: true, email: false } }).providers.length === 0);
ok("signups disabled is respected", parseAuthSettings({ disable_signup: true }).signupsAllowed === false);

const empty = parseAuthSettings({});
ok("missing settings are treated as nothing enabled, not guessed", empty.email === false && empty.providers.length === 0);
ok("garbage input does not throw", parseAuthSettings(null).email === false && parseAuthSettings("nope").providers.length === 0);
ok("a backend with no auth method is detected", hasNoAuthMethod(empty) === true);
ok("NO_AUTH is the safe default", hasNoAuthMethod(NO_AUTH) === true);

ok("wrong password is explained, not echoed raw",
  /don't match an account/.test(authErrorMessage(new Error("Invalid login credentials"))));
ok("unconfirmed email tells the user to open the link",
  /Confirm your email/.test(authErrorMessage(new Error("Email not confirmed"))));
ok("duplicate signup points at signing in",
  /already exists/.test(authErrorMessage(new Error("User already registered"))));
ok("disabled signups are explained",
  /disabled on this workspace/.test(authErrorMessage(new Error("Signups not allowed for this instance"))));
ok("email rate limit is explained",
  /Wait a few minutes/.test(authErrorMessage(new Error("email rate limit exceeded"))));
ok("a backend with no mail provider is called out",
  /email provider isn't set up/.test(authErrorMessage(new Error("Error sending confirmation email"))));
ok("offline is explained", /Couldn't reach the server/.test(authErrorMessage(new Error("Failed to fetch"))));
ok("unrecognised errors are passed through verbatim", authErrorMessage(new Error("weird backend thing")) === "weird backend thing");
ok("empty error still yields a message", authErrorMessage(undefined) === "Sign-in failed.");
ok("unavailable provider names itself", /Microsoft sign-in isn't enabled/.test(providerUnavailableMessage("azure")));

ok("blank email is caught before a network call", validateCredentials("", "password123") === "Enter your email address.");
ok("malformed email is caught", /email address/.test(validateCredentials("nope", "password123")));
ok("blank password is caught", validateCredentials("a@b.com", "") === "Enter your password.");
ok("short password is caught", /at least/.test(validateCredentials("a@b.com", "short")));
ok("valid credentials pass", validateCredentials("amy@health.ucsd.edu", "correct horse battery") === "");
ok("plus-addressing is accepted", validateCredentials("max+ledgeur@gmail.com", "password123") === "");

ok("sign-up next step asks for confirmation when required", /confirmation link/.test(signUpNextStep(live)));
ok("sign-up next step says you're in when auto-confirmed", /signed in/.test(signUpNextStep(bothOn)));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
