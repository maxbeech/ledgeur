import type { ApiErrorCode } from "@ledgeur/core/api";

/** Thrown inside a handler; the router turns it into the error envelope. */
export class ApiError extends Error {
  constructor(readonly status: number, readonly code: ApiErrorCode, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

export const badRequest = (message: string) => new ApiError(400, "bad_request", message);
export const notFound = (what = "That resource") => new ApiError(404, "not_found", `${what} was not found.`);

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}

export function errorResponse(e: ApiError): Response {
  const headers: Record<string, string> = e.status === 401 ? { "WWW-Authenticate": 'Bearer realm="ledgeur"' } : {};
  return json({ error: { code: e.code, message: e.message } }, e.status, headers);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: string) => UUID.test(s);

export function isIsoDate(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) && !Number.isNaN(Date.parse(v));
}
