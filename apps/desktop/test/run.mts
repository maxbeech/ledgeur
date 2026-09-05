// Desktop app pure-logic tests. Run: pnpm --filter @ledgeur/desktop test
import { existsSync, readFileSync, readdirSync } from "node:fs";
// Only import modules free of browser-only globals (no import.meta.env, DOM).
import { mergeThread, quoteOf, messageToItem, type ThreadItem } from "../src/lib/thread.ts";
import { parseAiNotes, buildNotesPrompt } from "../src/lib/notes.ts";
import {
  authErrorMessage, hasNoAuthMethod, NO_AUTH, parseAuthSettings, providerUnavailableMessage,
  signUpNextStep, validateCredentials,
} from "@ledgeur/core";
import type { LocalSegment, ChatMessage } from "../src/lib/meetingsStore.ts";
import { renameSpeakerInMeeting } from "../src/lib/renameSpeaker.ts";
import { runModelWarmupTests } from "./modelWarmup.mts";

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

// --- buildNotesPrompt: the notes the user typed have to actually reach the model ---
//
// They were stored and rendered but never sent, which made typing during a
// meeting pointless — the summary came out the same whether or not you'd noted
// what mattered. These assert the wiring and the guard-rail on it.
{
  const plain = buildNotesPrompt("we agreed to ship on Friday", "");
  ok("a transcript-only prompt has system + user", plain.length === 2 && plain[0].role === "system");
  ok("a transcript-only prompt carries the transcript", plain[1].content.includes("ship on Friday"));
  ok("a transcript-only prompt does not mention the user's notes",
    !plain[0].content.includes("typed their own"), plain[0].content.slice(-80));

  const withNotes = buildNotesPrompt("we agreed to ship on Friday", "pricing - Sam pushing back");
  ok("typed notes reach the model", withNotes[1].content.includes("Sam pushing back"));
  ok("the transcript is still sent alongside them", withNotes[1].content.includes("ship on Friday"));
  ok("typed notes add the prioritising instruction", withNotes[0].content.includes("priority"));
  // The instruction not to elaborate an unsupported fragment is the difference
  // between expanding someone's shorthand and inventing a quote for them.
  ok("the model is told not to invent detail for a fragment",
    /not supported by the transcript/i.test(withNotes[0].content));

  const blank = buildNotesPrompt("transcript here", "   \n  ");
  ok("whitespace-only notes are treated as none", !blank[0].content.includes("priority"));

  const long = buildNotesPrompt("x".repeat(60000), "");
  ok("an over-long transcript is truncated", long[1].content.includes("(truncated)"));
  ok("truncation keeps the prompt bounded", long[1].content.length < 50000, String(long[1].content.length));
}

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
  /don’t match an account/.test(authErrorMessage(new Error("Invalid login credentials"))));
ok("unconfirmed email tells the user to open the link",
  /Confirm your email/.test(authErrorMessage(new Error("Email not confirmed"))));
ok("duplicate signup points at signing in",
  /already exists/.test(authErrorMessage(new Error("User already registered"))));
ok("disabled signups are explained",
  /disabled on this workspace/.test(authErrorMessage(new Error("Signups not allowed for this instance"))));
ok("email rate limit is explained",
  /Wait a few minutes/.test(authErrorMessage(new Error("email rate limit exceeded"))));
ok("a backend with no mail provider is called out",
  /email provider isn’t set up/.test(authErrorMessage(new Error("Error sending confirmation email"))));
ok("offline is explained", /Couldn’t reach the server/.test(authErrorMessage(new Error("Failed to fetch"))));
ok("unrecognised errors are passed through verbatim", authErrorMessage(new Error("weird backend thing")) === "weird backend thing");
ok("empty error still yields a message", authErrorMessage(undefined) === "Sign-in failed.");
ok("unavailable provider names itself", /Microsoft sign-in isn’t enabled/.test(providerUnavailableMessage("azure")));

ok("blank email is caught before a network call", validateCredentials("", "password123") === "Enter your email address.");
ok("malformed email is caught", /email address/.test(validateCredentials("nope", "password123")));
ok("blank password is caught", validateCredentials("a@b.com", "") === "Enter your password.");
ok("short password is caught", /at least/.test(validateCredentials("a@b.com", "short")));
ok("valid credentials pass", validateCredentials("amy@health.ucsd.edu", "correct horse battery") === "");
ok("plus-addressing is accepted", validateCredentials("max+ledgeur@gmail.com", "password123") === "");

ok("sign-up next step asks for confirmation when required", /confirmation link/.test(signUpNextStep(live)));
ok("sign-up next step says you're in when auto-confirmed", /signed in/.test(signUpNextStep(bothOn)));

// --- naming a speaker ---
// The rename joins `speakers` and `segments` on a label string, because this
// app stores segments by label rather than by cluster index. Updating one and
// not the other leaves a transcript pointing at a speaker that no longer exists.
{
  const meeting = {
    id: "m1", title: "t", createdAt: "", startedAt: null, endedAt: null,
    status: "complete" as const, lang: "en",
    segments: [
      { id: "s1", speakerLabel: "Speaker 1", startMs: 0, endMs: 1000, text: "a", confidence: null, speakerConfidence: 0.7 },
      { id: "s2", speakerLabel: "Speaker 2", startMs: 1000, endMs: 2000, text: "b", confidence: null, speakerConfidence: null },
      { id: "s3", speakerLabel: "Speaker 1", startMs: 2000, endMs: 3000, text: "c", confidence: null, speakerConfidence: 0.7 },
    ],
    speakers: [
      { label: "Speaker 1", confidence: 0.7, embedding: [1, 0, 0], speakingSeconds: 2 },
      { label: "Speaker 2", confidence: null, speakingSeconds: 1 },
    ],
    summary: [], decisions: [], questions: [], actionItems: [],
    noteMarkdown: "", wordCount: 0, synced: false,
  };

  const renamed = await renameSpeakerInMeeting(meeting, "Speaker 1", "Priya");
  ok("renaming relabels every one of that speaker's segments",
    renamed.meeting.segments.filter((s) => s.speakerLabel === "Priya").length === 2,
    JSON.stringify(renamed.meeting.segments.map((s) => s.speakerLabel)));
  ok("renaming leaves the other speaker alone",
    renamed.meeting.segments[1].speakerLabel === "Speaker 2");
  ok("renaming updates the speaker row too",
    renamed.meeting.speakers?.some((s) => s.label === "Priya"));
  // A name somebody typed is not a guess, so the percentage must go.
  ok("a hand-typed name drops the confidence figure on the segments",
    renamed.meeting.segments.filter((s) => s.speakerLabel === "Priya").every((s) => s.speakerConfidence === null));
  ok("a hand-typed name drops the confidence figure on the speaker",
    renamed.meeting.speakers?.find((s) => s.label === "Priya")?.confidence === null);
  ok("renaming does not mutate the original", meeting.segments[0].speakerLabel === "Speaker 1");

  const unchanged = await renameSpeakerInMeeting(meeting, "Speaker 1", "  ");
  ok("an empty name is ignored", unchanged.meeting === meeting);
  const same = await renameSpeakerInMeeting(meeting, "Speaker 1", "Speaker 1");
  ok("renaming to the same name is a no-op", same.meeting === meeting);

  // A speaker with no stored print can still be renamed — it just cannot teach
  // the app that voice, and it has to say so rather than pretend.
  const noPrint = await renameSpeakerInMeeting(meeting, "Speaker 2", "Sam");
  ok("a speaker with no stored print is still renamed",
    noPrint.meeting.segments[1].speakerLabel === "Sam");
  ok("a speaker with no stored print explains why it will not be remembered",
    /cannot teach|no stored voice print/i.test(noPrint.rememberError), noPrint.rememberError);
}

// --- one copy of each shared module ---
// `capture.ts`, `transcriber.ts` and the auth wording each existed twice, once
// here and once on the website, and every one of them had drifted: this app's
// capture called the shared-audio option `system` while the website's called it
// `tab`, and only one of them stopped the video track. They live in
// @ledgeur/core now, and a stray re-fork must fail the build rather than being
// noticed six months later by a bug that only reproduces on one surface.
for (const forked of ["capture.ts", "transcriber.ts", "authMessages.ts"]) {
  ok(`src/lib/${forked} is not forked out of @ledgeur/core`,
    !existsSync(new URL(`../src/lib/${forked}`, import.meta.url)));
}
ok("the app imports capture and transcription from the shared package", (() => {
  const recorder = readFileSync(new URL("../src/lib/useRecorder.ts", import.meta.url), "utf8");
  return /from "@ledgeur\/core\/browser"/.test(recorder);
})());

// --- one design system, both apps ---
// The website is held to this too (apps/marketing/test/site.mts). The sidebar's
// recording dot was a raw `bg-red-400` because the `danger` token is 2.55:1 on
// the ink chrome and genuinely unreadable there — the fix was a `dangerOnInk`
// token, not a hand-picked colour in a component.
function tsxFiles(dir: URL): URL[] {
  const out: URL[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, dir);
    if (entry.isDirectory()) out.push(...tsxFiles(child));
    else if (entry.name.endsWith(".tsx")) out.push(child);
  }
  return out;
}
const surfaces = tsxFiles(new URL("../src/", import.meta.url));
ok("there are surfaces to check", surfaces.length > 10, `${surfaces.length}`);
for (const file of surfaces) {
  const src = readFileSync(file, "utf8");
  const raw = /\b(?:text|bg|border|ring|from|to)-(?:stone|emerald|amber|slate|gray|zinc|neutral|rose|red|green|blue|indigo|teal|orange|yellow|lime|cyan|sky|violet|purple|fuchsia|pink)-\d{2,3}\b/.exec(src);
  ok(`${file.pathname.split("/desktop/")[1]} uses design tokens`, raw === null, raw?.[0]);
}

await runModelWarmupTests(ok);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
