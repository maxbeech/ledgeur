export type LedgeurErrorCode =
  | "unauthorized" | "plan_required" | "not_found" | "bad_request"
  | "rate_limited" | "not_configured" | "internal" | "network_error" | "unknown";

/** The API answered with an error. */
export class LedgeurError extends Error {
  readonly status: number;
  readonly code: LedgeurErrorCode | (string & {});
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "LedgeurError";
    this.status = status;
    this.code = code;
  }
}

/** A webhook delivery could not be trusted. */
export class LedgeurWebhookError extends Error {
  readonly reason: "malformed" | "bad_signature" | "stale" | "bad_body";
  constructor(reason: LedgeurWebhookError["reason"], message: string) {
    super(message);
    this.name = "LedgeurWebhookError";
    this.reason = reason;
  }
}
