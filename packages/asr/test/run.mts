// @ledgeur/asr test suite — the browser speech-to-text load plan. Run: pnpm test
//
// These guard the fix for the production outage where every non-WebGPU user got
// "Can't create a session … TransposeDQWeightsForMatMulNBits Missing required
// scale" and could not transcribe at all (transformers.js 4.x + int8 Whisper).

import { readFileSync } from "node:fs";
import { buildLoadPlan, friendlyAsrError, normaliseLang, runtimeUrl, RUNTIMES, LANGS } from "../asr-plan.js";
import { ASSETS, checkTargets, sourcePath } from "../sync.mjs";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.error(`  FAIL ${name} ${detail}`); }
};

// --- plan shape ---
const gpuPlan = buildLoadPlan("en", { webgpu: true });
const cpuPlan = buildLoadPlan("en", { webgpu: false });

ok("WebGPU machines try WebGPU first", gpuPlan[0].device === "webgpu", gpuPlan[0].id);
ok("WebGPU plan falls back to CPU", gpuPlan.slice(1).every((s) => s.device === "wasm") && gpuPlan.length === 3, JSON.stringify(gpuPlan.map((s) => s.id)));
ok("machines without WebGPU never attempt it", cpuPlan.every((s) => s.device === "wasm"), JSON.stringify(cpuPlan.map((s) => s.id)));
ok("plan always offers at least two rungs", cpuPlan.length >= 2, `${cpuPlan.length}`);
ok("missing caps object is treated as no WebGPU", buildLoadPlan("en").every((s) => s.device === "wasm"));

// --- the regression itself ---
// transformers.js 4.x cannot create a session for the int8 Whisper exports, so
// no rung may pair the 4.x runtime with a quantised dtype.
for (const lang of LANGS) {
  for (const caps of [{ webgpu: true }, { webgpu: false }]) {
    const plan = buildLoadPlan(lang, caps);
    ok(`[${lang} webgpu=${caps.webgpu}] no rung pairs runtime 4.x with a quantised dtype`,
      plan.every((s) => !(s.runtime.startsWith("4.") && s.dtype !== "fp32")),
      JSON.stringify(plan.map((s) => `${s.runtime}/${s.dtype}`)));
    ok(`[${lang} webgpu=${caps.webgpu}] every rung pins an explicit dtype`,
      plan.every((s) => typeof s.dtype === "string" && s.dtype.length > 0));
    ok(`[${lang} webgpu=${caps.webgpu}] every rung names a model and a runtime`,
      plan.every((s) => s.model.includes("/") && /^\d+\.\d+\.\d+$/.test(s.runtime)));
    ok(`[${lang} webgpu=${caps.webgpu}] rung ids are unique`,
      new Set(plan.map((s) => s.id)).size === plan.length);
    ok(`[${lang} webgpu=${caps.webgpu}] the last rung is the most conservative (fp32)`,
      plan[plan.length - 1].dtype === "fp32");
  }
}

// The small int8 download must stay the default for CPU users — falling back to
// the 152 MB fp32 model for everyone would be a 4x regression in first load.
ok("CPU users get the small quantised model first", cpuPlan[0].dtype === "q8" && cpuPlan[0].runtime === RUNTIMES.stable);
ok("stable runtime is a 3.x release (verified to load int8 exports)", RUNTIMES.stable.startsWith("3."));

// --- lang handling ---
ok("normaliseLang passes supported langs through", LANGS.every((l) => normaliseLang(l) === l));
ok("normaliseLang defaults unknown input to en", normaliseLang("klingon") === "en" && normaliseLang(undefined) === "en");
ok("multi uses a multilingual model", buildLoadPlan("multi", { webgpu: false })[0].model === "Xenova/whisper-tiny");
ok("en uses an English-only model", cpuPlan[0].model.endsWith(".en"));
ok("en-hq uses the larger base model", buildLoadPlan("en-hq", { webgpu: false })[0].model === "Xenova/whisper-base.en");
ok("unknown lang produces the en plan", JSON.stringify(buildLoadPlan("zz", { webgpu: false })) === JSON.stringify(cpuPlan));

// --- runtime url ---
ok("runtimeUrl pins an exact version", runtimeUrl("3.8.1") === "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1");

// --- error mapping ---
const sessionErr = "Can't create a session. ERROR_CODE: 1, ERROR_MESSAGE: qdq_actions.cc:137 TransposeDQWeightsForMatMulNBits Missing required scale: model.decoder.embed_tokens.weight_merged_0_scale";
const exhausted = friendlyAsrError(new Error(sessionErr), { exhausted: true });
ok("session failure explains what to do", /update your browser/i.test(exhausted), exhausted);
ok("session failure keeps the raw error for support", exhausted.includes("qdq_actions.cc"));
ok("session failure mid-plan says it is retrying", /retrying/i.test(friendlyAsrError(new Error(sessionErr))));
ok("network failure names the likely cause", /connection|firewall/i.test(friendlyAsrError(new Error("Failed to fetch"), { exhausted: true })));
ok("memory failure suggests a fix", /memory/i.test(friendlyAsrError(new Error("Aborted(). Build with -sASSERTIONS for more info. out of memory"), { exhausted: true })));
ok("unknown failure still surfaces the raw text", friendlyAsrError(new Error("kaboom"), { exhausted: true }).includes("kaboom"));
ok("non-Error input is handled", typeof friendlyAsrError("plain string") === "string" && friendlyAsrError("plain string").includes("plain string"));
ok("empty error never yields a dangling parenthesis", !friendlyAsrError(undefined).includes("()"));

// --- worker contract ---
const worker = readFileSync(sourcePath("transcribe.worker.js"), "utf8");
ok("worker imports the shared plan rather than hardcoding models", worker.includes('from "./asr-plan.js"'));
ok("worker hardcodes no model ids", !/Xenova\/|onnx-community\//.test(worker));
ok("worker hardcodes no CDN version", !/transformers@\d/.test(worker));
ok("worker reports load failures with a hasNext flag so the controller can retry", worker.includes("hasNext"));

// --- single source of truth ---
const drifted = checkTargets();
ok("every app's public/ copy matches the canonical asset", drifted.length === 0,
  drifted.length ? `stale: ${drifted.join(", ")} — run: node packages/asr/sync.mjs` : "");
ok("both assets are published to the apps", ASSETS.length === 2);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
