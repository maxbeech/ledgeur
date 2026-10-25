// Failures that are a person's or a device's state, not a defect.
//
// A dismissed screen-share prompt, a recording with no speech in it, a model load
// cancelled because the page was closed: each is shown to the person in plain words
// and each is correct behaviour. Filing them as Sentry issues buried the real
// faults (LEDGEUR_WEB-7/-8/-9). The thrower says which kind it is raising, so no
// message is ever matched by its wording.
//
// Duck-typed on `expected === true` so it holds across realms and bundles, and so
// `CaptureError` (which carries the flag itself) needs no shared base class.

/** An error the person is told about and that nobody needs to triage. */
export class ExpectedClientError extends Error {
  readonly expected = true;
  constructor(message: string) {
    super(message);
    this.name = "ExpectedClientError";
  }
}

/** Whether `err` was raised as a person's or device's state, not a fault. */
export function isExpectedClientError(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { expected?: unknown }).expected === true;
}
