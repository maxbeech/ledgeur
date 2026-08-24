// Ledgeur test suite. Pure-logic + data-integrity checks. Run: npm test
import { existsSync, readFileSync } from "node:fs";
// The canonical speech-model load plan, as served to the browser.
import { LANGS as ASR_LANGS, LANG_OPTIONS as ASR_LANG_OPTIONS } from "../public/asr-plan.js";
// Notes, audio and the AI-key plumbing all live in the shared package now —
// this app used to carry forked copies that had already drifted from it.
import {
  splitSentences, extractiveSummary, summarizeTranscript, notesToMarkdown,
  resample, mergeToMono, rms, concatFloat32, WHISPER_SAMPLE_RATE,
  buildNotesRequest, providerById, AI_PROVIDERS,
  authErrorMessage,
} from "@ledgeur/core";
import { evaluateSupport } from "../lib/support.ts";
import { COMPETITORS } from "../lib/competitors.ts";
import { PLATFORMS } from "../lib/platforms.ts";
import { USE_CASES } from "../lib/usecases.ts";
import { POSTS } from "../lib/posts.ts";
import {
  classifyAsset, toRelease, assetsFor, formatBytes, repoPath, latestReleaseApiUrl,
  DOWNLOAD_REVALIDATE_SECONDS,
} from "../lib/downloads.ts";
import { SUPABASE, MIN_PASSWORD_LENGTH } from "../lib/site.ts";
import { runSiteTests } from "./site.mts";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.error(`  FAIL ${name} ${detail}`); }
};

// --- summarize ---
const transcript =
  "Welcome everyone to the planning call. We decided to ship the new pricing page next week. " +
  "I'll write the copy by Friday. Sarah will handle the design. " +
  "Should we also update the docs? Let's follow up on the analytics integration. " +
  "The plan is to launch on the 30th. What about the mobile layout?";

const sentences = splitSentences(transcript);
ok("splitSentences finds multiple sentences", sentences.length >= 6, `got ${sentences.length}`);
ok("extractiveSummary respects max", extractiveSummary(sentences, 3).length === 3);
ok("extractiveSummary preserves order", (() => {
  const s = extractiveSummary(sentences, 3);
  const idx = s.map((x) => sentences.indexOf(x));
  return idx.every((v, i) => i === 0 || v > idx[i - 1]);
})());

const notes = summarizeTranscript(transcript);
ok("finds action items", notes.actionItems.some((a) => a.includes("Friday")), JSON.stringify(notes.actionItems));
ok("finds decisions", notes.decisions.some((d) => d.toLowerCase().includes("decided")), JSON.stringify(notes.decisions));
ok("finds questions", notes.questions.length >= 2, JSON.stringify(notes.questions));
ok("a question is NOT also listed as an action item", !notes.actionItems.some((a) => a.endsWith("?")), JSON.stringify(notes.actionItems));
ok("wordCount > 0", notes.wordCount > 30);
ok("empty transcript is safe", (() => { const n = summarizeTranscript(""); return n.summary.length === 0 && n.wordCount === 0; })());

const md = notesToMarkdown("Planning call", "2026-06-14", notes, transcript);
ok("markdown has title", md.startsWith("# Planning call"));
ok("markdown has action items as checkboxes", md.includes("- [ ] "));
ok("markdown includes transcript", md.includes("## Transcript"));

// --- audio ---
ok("resample identity when same rate", resample(new Float32Array([1, 2, 3]), 16000, 16000).length === 3);
ok("resample downsamples 32k->16k by ~half", (() => {
  const out = resample(new Float32Array(3200), 32000, WHISPER_SAMPLE_RATE);
  return Math.abs(out.length - 1600) <= 2;
})());
ok("resample empty is empty", resample(new Float32Array(0), 48000).length === 0);
ok("mergeToMono averages two channels", (() => {
  const m = mergeToMono([new Float32Array([0, 1]), new Float32Array([1, 1])]);
  return m[0] === 0.5 && m[1] === 1;
})());
ok("mergeToMono single passthrough", mergeToMono([new Float32Array([0.5])])[0] === 0.5);
ok("rms of zeros is 0", rms(new Float32Array([0, 0, 0])) === 0);
ok("rms of constant equals magnitude", Math.abs(rms(new Float32Array([0.5, 0.5])) - 0.5) < 1e-9);
ok("concatFloat32 length sums", concatFloat32([new Float32Array(4), new Float32Array(6)]).length === 10);

// --- ai-notes ---
const req = buildNotesRequest("gpt-4o-mini", "hello world");
ok("request has model", req.model === "gpt-4o-mini");
ok("request has system + user", req.messages.length === 2 && req.messages[0].role === "system");
ok("request truncates long transcript", (() => {
  const big = "x".repeat(60000);
  return buildNotesRequest("m", big).messages[1].content.includes("(truncated)");
})());
ok("providerById falls back", providerById("nope").id === AI_PROVIDERS[0].id);
ok("every provider names a default model", AI_PROVIDERS.every((p) => !!p.defaultModel));
// The rule that matters is that an API key is never sent in the clear to
// somewhere else. Loopback is exempt — that is the on-device llama.cpp server,
// which browsers treat as a trustworthy origin precisely because it never
// leaves the machine.
ok("every remote provider is reached over https", AI_PROVIDERS.every((p) =>
  p.baseUrl.startsWith("https://") || /^http:\/\/(127\.0\.0\.1|\[::1\]|localhost)(:|\/)/.test(p.baseUrl)),
  JSON.stringify(AI_PROVIDERS.map((p) => p.baseUrl)));

// --- browser support detection ---
const full = evaluateSupport({ getDisplayMedia: true, getUserMedia: true, audioContext: true, worker: true });
ok("full support → all modes, no warning", full.canRecordMeeting && full.canRecordMic && full.canTranscribeFile && full.warning === "");
const noTab = evaluateSupport({ getDisplayMedia: false, getUserMedia: true, audioContext: true, worker: true });
ok("no getDisplayMedia → meeting off, mic+file on, warning shown", !noTab.canRecordMeeting && noTab.canRecordMic && noTab.canTranscribeFile && noTab.warning.length > 0);
const noEngine = evaluateSupport({ getDisplayMedia: true, getUserMedia: true, audioContext: false, worker: true });
ok("no AudioContext → nothing works, clear warning", !noEngine.canTranscribeFile && !noEngine.canRecordMic && !noEngine.canRecordMeeting && noEngine.warning.length > 0);

// --- data integrity ---
const uniq = (arr: string[]) => new Set(arr).size === arr.length;
ok("competitor slugs unique", uniq(COMPETITORS.map((c) => c.slug)));
ok("platform slugs unique", uniq(PLATFORMS.map((p) => p.slug)));
ok("usecase slugs unique", uniq(USE_CASES.map((u) => u.slug)));
ok("post slugs unique", uniq(POSTS.map((p) => p.slug)));
ok("at least 15 blog posts (Stage 4)", POSTS.length >= 15, `got ${POSTS.length}`);
ok("competitors populated", COMPETITORS.length >= 10 && COMPETITORS.every((c) => c.diff.length >= 3 && c.what.length > 10));
ok("platforms populated", PLATFORMS.length >= 6 && PLATFORMS.every((p) => p.tips.length >= 3));
ok("usecases populated", USE_CASES.length >= 8 && USE_CASES.every((u) => u.captures.length >= 3));
ok("posts well-formed", POSTS.every((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.date) && p.body.length >= 4 && p.title.length > 5));
ok("slugs are url-safe", [...COMPETITORS, ...PLATFORMS].every((x) => /^[a-z0-9-]+$/.test(x.slug)) && POSTS.every((p) => /^[a-z0-9-]+$/.test(p.slug)));

// --- transcription language options ---
// The picker and the speech-model load plan must agree: a value the plan does
// not know silently falls back to English, so somebody would choose "Other
// languages" and quietly get an English-only model and a nonsense transcript.
// They now come from the same file, so this asserts that stays true.
const offeredLangs = ASR_LANG_OPTIONS.map((o) => o.value);
ok("the recorder offers language options", offeredLangs.length >= 3, JSON.stringify(offeredLangs));
ok("every offered language is one the load plan supports",
  offeredLangs.every((l) => (ASR_LANGS as readonly string[]).includes(l)),
  `offered ${JSON.stringify(offeredLangs)} vs plan ${JSON.stringify(ASR_LANGS)}`);
ok("every planned language is offered in the UI",
  (ASR_LANGS as readonly string[]).every((l) => offeredLangs.includes(l)));
ok("every option has a label and a hint a person can act on",
  ASR_LANG_OPTIONS.every((o) => o.label.length > 0 && o.hint.length > 0));
const recordPanel = readFileSync(new URL("../components/app/RecordPanel.tsx", import.meta.url), "utf8");
ok("the picker reads the shared list rather than restating it",
  recordPanel.includes("LANG_OPTIONS") && !/const LANGUAGES/.test(recordPanel));

// --- auth callback page ---
// This page is where every Supabase auth email lands. If its config or copy
// drifts, a confirmed account or a password reset dead-ends silently.
const callbackSource = readFileSync(new URL("../app/auth/callback/page.tsx", import.meta.url), "utf8");
ok("the auth callback page is a client component (it must read location.hash)",
  callbackSource.trimStart().startsWith('"use client"'));
ok("the callback reads the URL fragment, not just the query string", callbackSource.includes("window.location.hash"));
ok("the callback handles the recovery flow", callbackSource.includes('"recovery"'));
ok("the callback sets the new password against Supabase", callbackSource.includes("/auth/v1/user") && callbackSource.includes('method: "PUT"'));
ok("the callback disables native validation so its own messages show", callbackSource.includes("noValidate"));
ok("the callback explains an expired link", /expired/i.test(callbackSource));

// The Supabase config the page depends on must be real, and publishable-only.
ok("Supabase url is configured", /^https:\/\/[a-z0-9]+\.supabase\.co$/.test(SUPABASE.url), SUPABASE.url);
ok("Supabase key is a JWT", SUPABASE.anonKey.split(".").length === 3);
ok("Supabase key is the publishable anon role, never a service key", (() => {
  const [, payload] = SUPABASE.anonKey.split(".");
  const json = JSON.parse(Buffer.from(payload, "base64url").toString());
  return json.role === "anon";
})(), "a service_role key must never reach the browser");
ok("Supabase key belongs to the configured project", (() => {
  const [, payload] = SUPABASE.anonKey.split(".");
  const json = JSON.parse(Buffer.from(payload, "base64url").toString());
  return SUPABASE.url.includes(json.ref);
})());

// One rule, one definition. The password minimum, the auth-capability parsing
// and the error wording used to exist twice — once here and once in the desktop
// app — with a test that compared the two copies. They now live in
// @ledgeur/core, so the check is that nobody has forked them back out.
ok("the password minimum is a real number", Number.isInteger(MIN_PASSWORD_LENGTH) && MIN_PASSWORD_LENGTH >= 8,
  `${MIN_PASSWORD_LENGTH}`);
const siteSrc = readFileSync(new URL("../lib/site.ts", import.meta.url), "utf8");
ok("the site re-exports the shared password rule rather than restating it",
  /export \{[^}]*MIN_PASSWORD_LENGTH[^}]*\} from "@ledgeur\/core"/.test(siteSrc), "site.ts should not declare its own");
ok("auth error wording comes from the shared package",
  authErrorMessage(new Error("Invalid login credentials")).includes("don’t match an account"),
  authErrorMessage(new Error("Invalid login credentials")));

// The forked copies of the notes/audio logic are gone for good.
for (const gone of ["summarize.ts", "ai-notes.ts", "audio.ts"]) {
  ok(`lib/${gone} is not forked back out of @ledgeur/core`, !existsSync(new URL(`../lib/${gone}`, import.meta.url)));
}

// --- the website itself ---
runSiteTests(ok);

// --- the download page ---
// It offers a real file from a real release or it says there is none. The one
// thing it must never do is render a button pointing at a file that is not there.

ok("the release API url is derived from the repo, not hardcoded twice",
  repoPath("https://github.com/maxbeech/ledgeur") === "maxbeech/ledgeur" &&
  latestReleaseApiUrl() === "https://api.github.com/repos/maxbeech/ledgeur/releases/latest",
  latestReleaseApiUrl());
ok("a trailing slash on the repo url does not break the path", repoPath("https://github.com/maxbeech/ledgeur/") === "maxbeech/ledgeur");

// Asset classification — these are the real filenames Tauri produces.
ok("a universal dmg is macOS for both architectures",
  classifyAsset("Ledgeur_0.2.0_universal.dmg")?.label === "macOS — Intel and Apple Silicon");
ok("an aarch64 dmg says Apple Silicon only",
  classifyAsset("Ledgeur_0.2.0_aarch64.dmg")?.label === "macOS — Apple Silicon only");
ok("an x64 dmg says Intel only", classifyAsset("Ledgeur_0.2.0_x64.dmg")?.label === "macOS — Intel only");
ok("an msi is Windows", classifyAsset("Ledgeur_0.2.0_x64_en-US.msi")?.platform === "windows");
ok("an AppImage is Linux", classifyAsset("ledgeur_0.2.0_amd64.AppImage")?.platform === "linux");
ok("a .deb is Linux", classifyAsset("ledgeur_0.2.0_amd64.deb")?.platform === "linux");

// Tauri publishes updater artifacts and signatures alongside the installers.
// Offering those as downloads would hand someone a file they cannot open.
ok("updater archives are not offered as downloads", classifyAsset("Ledgeur.app.tar.gz") === null);
ok("detached signatures are not offered", classifyAsset("Ledgeur.app.tar.gz.sig") === null);
ok("update manifests are not offered", classifyAsset("latest.json") === null);
ok("unknown files are not offered", classifyAsset("README.md") === null);

// Release parsing.
const releasePayload = {
  tag_name: "v0.2.0",
  published_at: "2026-08-17T20:00:00Z",
  html_url: "https://github.com/maxbeech/ledgeur/releases/tag/v0.2.0",
  assets: [
    { name: "Ledgeur_0.2.0_universal.dmg", browser_download_url: "https://example.test/u.dmg", size: 13_000_000 },
    { name: "latest.json", browser_download_url: "https://example.test/latest.json", size: 500 },
  ],
};
const parsed = toRelease(releasePayload)!;
ok("the version drops the leading v", parsed.version === "0.2.0", parsed.version);
ok("only installable assets survive parsing", parsed.assets.length === 1 && parsed.assets[0].filename.endsWith(".dmg"));
ok("the download url is the one GitHub gave us", parsed.assets[0].url === "https://example.test/u.dmg");

ok("a draft release is not offered", toRelease({ ...releasePayload, draft: true }) === null);
ok("a prerelease is not offered", toRelease({ ...releasePayload, prerelease: true }) === null);
ok("a release with no installable asset is treated as no release",
  toRelease({ ...releasePayload, assets: [{ name: "latest.json", browser_download_url: "u", size: 1 }] }) === null);
ok("a release with no tag is rejected", toRelease({ ...releasePayload, tag_name: undefined }) === null);
ok("garbage from the API does not throw", toRelease(null) === null && toRelease("nope") === null && toRelease({}) === null);
ok("an asset missing its url is skipped", (() => {
  const r = toRelease({ ...releasePayload, assets: [{ name: "Ledgeur_0.2.0_universal.dmg", size: 1 }] });
  return r === null;
})());

// Platform grouping.
ok("macOS assets are found", assetsFor(parsed, "macos").length === 1);
ok("platforms with no build return nothing, rather than someone else's file",
  assetsFor(parsed, "windows").length === 0 && assetsFor(parsed, "linux").length === 0);
ok("no release means no assets for any platform", assetsFor(null, "macos").length === 0);
ok("a universal build is offered before a single-architecture one", (() => {
  const both = toRelease({ ...releasePayload, assets: [
    { name: "Ledgeur_0.2.0_aarch64.dmg", browser_download_url: "https://example.test/a.dmg", size: 1 },
    { name: "Ledgeur_0.2.0_universal.dmg", browser_download_url: "https://example.test/u.dmg", size: 2 },
  ] })!;
  return assetsFor(both, "macos")[0].filename.includes("universal");
})());

// Sizes.
ok("small downloads keep a decimal, where it tells you something", formatBytes(7_400_000) === "7.4 MB", formatBytes(7_400_000));
ok("anything 10 MB or over is rounded — .2 of a megabyte helps nobody decide",
  formatBytes(13_200_000) === "13 MB" && formatBytes(210_000_000) === "210 MB",
  `${formatBytes(13_200_000)} / ${formatBytes(210_000_000)}`);
ok("small files fall back to KB", formatBytes(400_000) === "400 KB", formatBytes(400_000));
ok("an unknown size renders nothing rather than 0", formatBytes(0) === "" && formatBytes(NaN) === "");

// Wiring: a page nobody can reach is a page nobody reads.
const downloadPage = readFileSync(new URL("../app/download/page.tsx", import.meta.url), "utf8");
// Next only accepts a literal here, so the number is written twice by
// necessity. This is the guard that stops the two drifting.
const pageRevalidate = Number(/export const revalidate = (\d+)/.exec(downloadPage)?.[1]);
ok("the download page declares an ISR window", Number.isFinite(pageRevalidate), String(pageRevalidate));
ok("the page's ISR window matches the one the release fetch uses",
  pageRevalidate === DOWNLOAD_REVALIDATE_SECONDS, `page ${pageRevalidate} vs lib ${DOWNLOAD_REVALIDATE_SECONDS}`);
ok("the ISR window picks up a new release without a redeploy, but is not per-request",
  DOWNLOAD_REVALIDATE_SECONDS >= 600 && DOWNLOAD_REVALIDATE_SECONDS <= 86_400, `${DOWNLOAD_REVALIDATE_SECONDS}`);
ok("/download is in the sitemap",
  readFileSync(new URL("../app/sitemap.ts", import.meta.url), "utf8").includes("/download"));
ok("/download is linked from the header",
  readFileSync(new URL("../components/site/Chrome.tsx", import.meta.url), "utf8").includes('"/download"'));
ok("/download is linked from the footer",
  readFileSync(new URL("../lib/site.ts", import.meta.url), "utf8").includes('"/download"'));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
