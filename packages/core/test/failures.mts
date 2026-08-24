// The failure paths.
//
// Every check here exists because of a real defect found by driving the product
// in a browser rather than by reading the code:
//
//  • Clicking "Record a meeting" and being shown nothing at all when the
//    browser refused the microphone. The rejection was a DOMException whose
//    name meant nothing to a user, and the UI had no wording for it.
//  • The library sitting on "Opening your library…" forever. `indexedDB.open`
//    fires `blocked` and then neither `success` nor `error`, so a promise
//    wired to those two events never settles.
import { friendlyCaptureError } from "../src/browser/capture.ts";
import { openDatabase } from "../src/browser/idb.ts";

export async function runFailureTests(ok: (name: string, cond: boolean, detail?: string) => void) {
  // ---------- capture errors are written for people ----------
  const denied = new Error("Permission denied");
  denied.name = "NotAllowedError";

  const micDenied = friendlyCaptureError(denied, "mic");
  ok("a denied microphone explains how to undo it", /padlock|address bar/i.test(micDenied), micDenied);
  ok("a denied microphone does not show the DOMException name", !micDenied.includes("NotAllowedError"), micDenied);

  const shareDenied = friendlyCaptureError(denied, "system");
  ok("a dismissed share window is explained as a dismissal", /dismissed/i.test(shareDenied), shareDenied);
  ok("a dismissed share reminds you to tick the audio box", /share tab audio/i.test(shareDenied), shareDenied);

  const missing = new Error("Requested device not found");
  missing.name = "NotFoundError";
  ok("no microphone is explained", /No microphone was found/i.test(friendlyCaptureError(missing, "mic")));
  ok("nothing to share is explained", /Nothing was available to share/i.test(friendlyCaptureError(missing, "system")));

  const busy = new Error("Could not start video source");
  busy.name = "NotReadableError";
  const busyMsg = friendlyCaptureError(busy, "system");
  ok("a device in use names the likely cause", /another app is already using it/i.test(busyMsg), busyMsg);
  ok("a device in use says what to do", /Close anything else/i.test(busyMsg), busyMsg);

  const insecure = new Error("Only secure origins are allowed");
  insecure.name = "SecurityError";
  ok("an insecure origin is explained", /https/i.test(friendlyCaptureError(insecure, "mic")));

  const aborted = new Error("The operation was aborted");
  aborted.name = "AbortError";
  ok("an abort is explained rather than swallowed", /interrupted/i.test(friendlyCaptureError(aborted, "mic")));

  // Anything unrecognised must still be diagnosable.
  const weird = friendlyCaptureError(new Error("some novel browser bug"), "mic");
  ok("an unknown failure still says recording did not start", /could not start recording/i.test(weird), weird);
  ok("an unknown failure keeps the original text for a bug report",
    weird.includes("some novel browser bug"), weird);
  ok("a non-Error is handled", typeof friendlyCaptureError("boom", "mic") === "string");
  ok("null is handled", friendlyCaptureError(null, "mic").length > 0);
  ok("an empty failure leaves no dangling parenthesis", !friendlyCaptureError(undefined, "mic").includes("()"));

  // Every message must be a sentence, not a code.
  for (const [name, source] of [["NotAllowedError", "mic"], ["NotFoundError", "system"], ["NotReadableError", "mic"]] as const) {
    const err = new Error("x");
    err.name = name;
    const message = friendlyCaptureError(err, source);
    ok(`${name} on ${source} reads as a sentence`, /^[A-Z].*[.!?]$/s.test(message.split("\n")[0]), message);
  }

  // ---------- translation is the default, not the exception ----------
  // This guard used to be "translate it unless it is an Error that is not a
  // DOMException". That held for real browser rejections and nothing else: a
  // plain Error from a polyfill or another realm passed through untranslated,
  // putting "NotReadableError: Could not start video source" in front of a
  // user. Only messages this file wrote are exempt now.
  const { CaptureError } = await import("../src/browser/capture.ts");
  const ours = new CaptureError("Choose your microphone, the meeting audio, or both.");
  ok("our own message is recognised as already human", ours instanceof CaptureError);
  ok("our own message is still an Error", ours instanceof Error);

  const plain = new Error("Could not start video source");
  plain.name = "NotReadableError";
  ok("a plain Error is NOT treated as already human", !(plain instanceof CaptureError));
  ok("a plain Error with a DOMException name still translates",
    /another app is already using it/i.test(friendlyCaptureError(plain, "system")),
    friendlyCaptureError(plain, "system"));

  // ---------- opening a database can fail, but must never hang ----------
  // No IndexedDB in Node: the helper has to reject rather than sit there.
  const before = (globalThis as { indexedDB?: unknown }).indexedDB;
  ok("this environment has no IndexedDB, which is the case being tested", before === undefined);

  let settled = false;
  const attempt = openDatabase("ledgeur-test", 1, [{ name: "x", keyPath: "id" }])
    .then(() => { settled = true; return "resolved"; })
    .catch((e: Error) => { settled = true; return e.message; });

  // If the promise hangs, this race returns the sentinel and the test fails —
  // which is exactly the bug that shipped.
  const outcome = await Promise.race([
    attempt,
    new Promise<string>((resolve) => setTimeout(() => resolve("__HUNG__"), 1500)),
  ]);
  ok("opening a database settles rather than hanging", outcome !== "__HUNG__", outcome);
  ok("it settled", settled);
  ok("an unavailable database explains itself", /no local database|cannot be stored/i.test(outcome), outcome);
  ok("the message avoids jargon", !/IndexedDB|IDBOpenDBRequest/i.test(outcome), outcome);
}
