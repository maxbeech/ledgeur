// @ledgeur/asr test suite — the browser speech-to-text load plan. Run: pnpm test
//
// These guard the fix for the production outage where every non-WebGPU user got
// "Can't create a session … TransposeDQWeightsForMatMulNBits Missing required
// scale" and could not transcribe at all (transformers.js 4.x + int8 Whisper).

import { readFileSync } from "node:fs";
import { buildLoadPlan, friendlyAsrError, normaliseLang, runtimeUrl, RUNTIMES, LANGS } from "../asr-plan.js";
import {
  buildDiarizePlan, friendlyDiarizeError, planWindows, DIARIZE_RUNTIME,
  SEGMENTATION_MODEL, EMBEDDING_MODEL, WINDOW_SECONDS, WINDOW_STRIDE_SECONDS,
  MIN_EMBED_SECONDS, MAX_EMBED_SECONDS, DIARIZE_SAMPLE_RATE,
} from "../diarize-plan.js";
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
// Named rather than counted: a new worker should not be able to ship without
// being added here, and adding one should not break the test that guards it.
for (const name of ["asr-plan.js", "transcribe.worker.js", "diarize-plan.js", "diarize.worker.js"]) {
  ok(`${name} is published to the apps`, ASSETS.includes(name), JSON.stringify(ASSETS));
}
ok("every published asset exists at its canonical path",
  ASSETS.every((name) => readFileSync(sourcePath(name), "utf8").length > 0));


// --- diarization plan ---
const dGpu = buildDiarizePlan({ webgpu: true });
const dCpu = buildDiarizePlan({ webgpu: false });

ok("diarization tries WebGPU first when available", dGpu[0].device === "webgpu", dGpu[0].id);
ok("diarization works without WebGPU", dCpu.length >= 2 && dCpu.every((s) => s.device === "wasm"), JSON.stringify(dCpu.map((s) => s.id)));
ok("missing caps means no WebGPU attempt", buildDiarizePlan().every((s) => s.device === "wasm"));
ok("every diarization rung names an explicit dtype", [...dGpu, ...dCpu].every((s) => typeof s.dtype === "string" && s.dtype.length > 0));
ok("every diarization rung has a human label", [...dGpu, ...dCpu].every((s) => typeof s.label === "string" && s.label.length > 0));
ok("diarization rung ids are unique", new Set(dGpu.map((s) => s.id)).size === dGpu.length, JSON.stringify(dGpu.map((s) => s.id)));

// One runtime major per page: loading two copies of onnxruntime-web in the same
// document is exactly the kind of thing that poisons a session.
ok("diarization pins the same runtime the ASR ladder trusts", DIARIZE_RUNTIME === RUNTIMES.stable, `${DIARIZE_RUNTIME} vs ${RUNTIMES.stable}`);
ok("every diarization rung uses the pinned runtime", [...dGpu, ...dCpu].every((s) => s.runtime === DIARIZE_RUNTIME));

// The un-gated mirrors matter: pyannote's own repos require accepting terms,
// which would put a login in front of an offline-first product's first run.
ok("segmentation uses the un-gated onnx-community mirror", SEGMENTATION_MODEL === "onnx-community/pyannote-segmentation-3.0", SEGMENTATION_MODEL);
ok("embedding uses the un-gated onnx-community mirror", EMBEDDING_MODEL === "onnx-community/wespeaker-voxceleb-resnet34-LM", EMBEDDING_MODEL);

// --- windowing ---
const R = DIARIZE_SAMPLE_RATE;
ok("a clip shorter than one window is a single pass", planWindows(R * 5).length === 1);
ok("a short clip's single window covers all of it", planWindows(R * 5)[0].end === R * 5);
ok("zero-length audio plans no windows", planWindows(0).length === 0);
ok("negative length is refused rather than looping", planWindows(-1).length === 0);
ok("a zero sample rate is refused", planWindows(R * 5, 0).length === 0);

const w25 = planWindows(R * 25);
ok("a long clip is split into windows", w25.length > 1, `${w25.length}`);
ok("windows advance by the stride", w25[1].offsetSeconds === WINDOW_STRIDE_SECONDS, `${w25[1].offsetSeconds}`);
ok("windows overlap, so a boundary turn is seen whole", WINDOW_STRIDE_SECONDS < WINDOW_SECONDS);
ok("the last window ends exactly at the clip end", w25[w25.length - 1].end === R * 25);
ok("no window runs past the clip", w25.every((w) => w.end <= R * 25));
ok("no window is empty", w25.every((w) => w.end > w.start));
ok("windows start at zero", w25[0].start === 0 && w25[0].offsetSeconds === 0);
ok("every second of the clip is covered", (() => {
  let reach = 0;
  for (const w of w25) { if (w.start > reach) return false; reach = Math.max(reach, w.end); }
  return reach === R * 25;
})(), JSON.stringify(w25));
ok("a very long clip stays linear rather than exploding", planWindows(R * 3600).length < 500, `${planWindows(R * 3600).length}`);

ok("the embed floor is below the cap", MIN_EMBED_SECONDS < MAX_EMBED_SECONDS);
ok("the embed floor clears the extractor's 9-frame minimum", MIN_EMBED_SECONDS > 0.115, `${MIN_EMBED_SECONDS}`);
ok("a turn worth embedding fits inside a window", MIN_EMBED_SECONDS < WINDOW_SECONDS);

// --- diarization error wording ---
// Diarization failing must never read as "your recording is broken": the
// transcript is fine, it just has no names on it.
const netMsg = friendlyDiarizeError(new Error("Failed to fetch"));
ok("a network failure names the cause", /connection|firewall/i.test(netMsg), netMsg);
ok("a network failure reassures about the transcript", /no speaker labels/i.test(netMsg), netMsg);
ok("an OOM says the transcript is unaffected", /unaffected/i.test(friendlyDiarizeError(new Error("out of memory"))));
const sessionMsg = friendlyDiarizeError(new Error("Can't create a session"), { exhausted: true });
ok("an exhausted session failure gives up gracefully", /unaffected/i.test(sessionMsg), sessionMsg);
ok("a retryable session failure says it is retrying", /retrying/i.test(friendlyDiarizeError(new Error("Can't create a session"), { exhausted: false })));
ok("the raw text is preserved for bug reports", friendlyDiarizeError(new Error("weird onnx thing")).includes("weird onnx thing"));
ok("an unknown failure still explains itself", /speaker labels/i.test(friendlyDiarizeError(new Error("???"))));
ok("a non-Error is handled", typeof friendlyDiarizeError("boom") === "string" && friendlyDiarizeError("boom").includes("boom"));
ok("null is handled", typeof friendlyDiarizeError(null) === "string" && friendlyDiarizeError(null).length > 0);

// --- the ASR worker must now emit timings ---
const workerSrc = readFileSync(sourcePath("transcribe.worker.js"), "utf8");
ok("the ASR worker asks Whisper for timestamps", /return_timestamps:\s*true/.test(workerSrc));
ok("the ASR worker sends chunks alongside the text", /status: "result", id, text, chunks/.test(workerSrc));
ok("the ASR worker offsets live slices onto the clip clock", /offsetSeconds/.test(workerSrc));

// --- both workers ship to both apps ---
ok("the diarization worker is a synced asset", ASSETS.includes("diarize.worker.js"), JSON.stringify(ASSETS));
ok("the diarization plan is a synced asset", ASSETS.includes("diarize-plan.js"), JSON.stringify(ASSETS));
const diarizeSrc = readFileSync(sourcePath("diarize.worker.js"), "utf8");
ok("the diarization worker imports the shared plan", /from "\.\/diarize-plan\.js"/.test(diarizeSrc));
ok("the diarization worker never posts audio anywhere", !/fetch\(|XMLHttpRequest|WebSocket/.test(diarizeSrc), "audio must never leave the device");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
