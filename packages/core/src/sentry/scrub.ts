// The one Sentry scrubber for Ledgeur (web, desktop). Pure functions, no SDK
// import, so it runs in the browser, Node, the edge runtime and the test suite.
//
// Contract (see _plans/SENTRY_STANDARD.md, section 2):
//   * Redact emails, phone numbers, bearer/JWT tokens, API keys and
//     password/secret/token/authorization fields, in messages AND attributes,
//     including serialised objects that contain them.
//   * Linear time. Every repetition is bounded and no quantifier is nested, and
//     any string longer than MAX_SCAN_CHARS is truncated BEFORE matching, so
//     hostile log text cannot cause ReDoS.
//   * Fail closed. Every hook is wrapped: if scrubbing throws, the event, log
//     or breadcrumb is dropped (null), never sent raw. Feedback events are the
//     one exception that keeps name and email (the person typed them in).
//   * Covers breadcrumbs (message + data, query strings stripped from
//     url/to/from) and transactions/spans (query strings stripped from the
//     request url and span http.url / url.query data).
//
// supabase/functions/_shared/scrub.ts is a Deno-side copy of the text and value
// half of this file (edge functions cannot import from the workspace); a test
// pins the two to the same output.

/** Strings longer than this are cut before any regex runs. */
export const MAX_SCAN_CHARS = 10_000;
const TRUNCATED = "…[truncated]";

const MAX_DEPTH = 6;
const MAX_KEYS = 100;
const MAX_ITEMS = 100;

// Every pattern below is anchored on a literal prefix or a single bounded class
// run; none has an unbounded or nested quantifier.
const EMAIL = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,255}\.[A-Za-z]{2,24}/g;

// International (+ prefix), grouped national numbers (020 7946 0958, (415)
// 555-0132), and UK mobiles. Deliberately does not match ISO dates or plain ids.
// No lookbehind: older WKWebView (Tauri on macOS < 13.3) rejects it at parse time.
const PHONE = /(^|[^\w+])(\+\d[\d\s().-]{7,17}\d|\(?\d{2,4}\)?[\s.-]\d{3,4}[\s.-]\d{3,4}|0\d{4} ?\d{6})(?![\w-])/g;

const BEARER = /\bbearer\s{1,8}[\w.~+/=-]{8,512}/gi;
const JWT = /eyJ[\w-]{10,2048}\.[\w-]{10,2048}\.[\w-]{5,2048}/g;
// sk_/pk_/rk_ (Stripe), whsec_, hlm_sk_ (Helm7), sntrys_ (Sentry), ldg_ (Ledgeur
// access tokens), sbp_/sb_secret_ (Supabase), sk- (OpenAI/Anthropic), gh*_
// (GitHub), AKIA (AWS), AIza (Google), xox* (Slack), secret_/ntn_ (Notion).
const API_KEY = new RegExp(
  "\\b(?:" +
    "(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{8,256}" +
    "|whsec_[A-Za-z0-9]{8,256}" +
    "|hlm_sk_[\\w-]{8,256}" +
    "|sntrys_[\\w=+/-]{8,512}" +
    "|ldg_[\\w-]{8,256}" +
    "|sbp_[A-Za-z0-9]{16,256}" +
    "|sb_secret_[\\w-]{8,256}" +
    "|sk-[A-Za-z0-9_-]{16,256}" +
    "|gh[pousr]_[A-Za-z0-9]{20,255}" +
    "|AKIA[0-9A-Z]{16}" +
    "|AIza[\\w-]{35}" +
    "|xox[abprs]-[\\w-]{10,200}" +
    "|(?:secret|ntn)_[A-Za-z0-9]{20,256}" +
  ")",
  "g",
);
// password=hunter2, "token":"abc", Authorization: xyz. Keeps the key, drops the value.
const SECRET_FIELD =
  /(password|passwd|pwd|secret|token|api[_-]?key|authorization|cookie|credentials?)(["']?\s{0,3}[:=]\s{0,3}["']?)[^\s"',;&]{1,512}/gi;

const SENSITIVE_KEY = /pass(?:word|wd)?$|^pwd$|secret|token|authori[sz]ation|api[_-]?key|cookie|credential|^auth$|private[_-]?key|^e-?mail$|^phone/i;
// Kept on feedback events: the person typed their own name and email in.
const CONTACT_KEY = /^(?:e-?mail|contact_email|name|username|phone)$/i;

export interface ScrubOptions {
  /** Feedback events keep name/email/phone. Secrets are still redacted. */
  keepContact?: boolean;
}

const cap = (s: string): string => (s.length > MAX_SCAN_CHARS ? s.slice(0, MAX_SCAN_CHARS) + TRUNCATED : s);

/** Redact secrets and personal identifiers in free text. Truncates first. */
export function scrubText(text: string, opts: ScrubOptions = {}): string {
  let out = cap(text);
  if (!opts.keepContact) out = out.replace(EMAIL, "[email]");
  out = out
    .replace(JWT, "[token]")
    .replace(BEARER, "[token]")
    .replace(API_KEY, "[token]")
    .replace(SECRET_FIELD, (_m, key: string, sep: string) => `${key}${sep}[redacted]`);
  if (!opts.keepContact) out = out.replace(PHONE, (_m, pre: string) => `${pre}[phone]`);
  return out;
}

/** Drop the query string and fragment from a URL or path. */
export function stripQuery(url: string): string {
  const cut = cap(url);
  const i = cut.search(/[?#]/);
  return i === -1 ? cut : cut.slice(0, i);
}

// "GET https://x.test/a?token=1" -> "GET https://x.test/a" (query dropped
// wherever an absolute URL appears in free text, e.g. a span description).
const URL_WITH_QUERY = /(https?:\/\/[^\s?#"'<>]{1,2048})[?#][^\s"'<>]{0,4096}/g;
function stripUrlsInText(text: string): string {
  return cap(text).replace(URL_WITH_QUERY, "$1");
}

/** Keys whose string value is a URL/path: query strings are removed outright. */
const URL_KEY = /^(?:url|to|from|href|http\.url|url\.full|http\.url\.full|request_url)$/i;
/** Keys that only ever hold a query string or fragment: dropped. */
const QUERY_KEY = /^(?:url\.query|http\.query|query|query_string|url\.fragment|http\.fragment|fragment|search)$/i;

/** Recursively scrub any value: strings by pattern, sensitive keys by name. */
export function scrubValue(value: unknown, opts: ScrubOptions = {}, depth = 0): unknown {
  if (typeof value === "string") return scrubText(value, opts);
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_DEPTH) return "[depth limit]";
  if (Array.isArray(value)) return value.slice(0, MAX_ITEMS).map((v) => scrubValue(v, opts, depth + 1));
  if (value instanceof Error) return scrubText(`${value.name}: ${value.message}`, opts);
  const out: Record<string, unknown> = {};
  let n = 0;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (++n > MAX_KEYS) break;
    if (SENSITIVE_KEY.test(k) && !(opts.keepContact && CONTACT_KEY.test(k))) {
      out[k] = "[redacted]";
    } else if (QUERY_KEY.test(k)) {
      continue;
    } else if (URL_KEY.test(k) && typeof v === "string") {
      out[k] = scrubText(stripQuery(v), opts);
    } else {
      out[k] = scrubValue(v, opts, depth + 1);
    }
  }
  return out;
}

/**
 * Structural guard for capture-helper context: ids, codes, counts and enum
 * values only. Numbers, booleans and short id/code-like strings (no spaces, no
 * "@") pass; free text, objects and arrays are replaced by a marker, so a
 * careless call site cannot ship user content even before the scrubber runs.
 */
export function safeContext(context: Record<string, unknown>): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  let n = 0;
  for (const [k, v] of Object.entries(context)) {
    if (++n > MAX_KEYS) break;
    if (v === null || typeof v === "boolean") out[k] = v;
    else if (typeof v === "number") out[k] = Number.isFinite(v) ? v : null;
    else if (typeof v === "string" && /^[\w:./-]{0,128}$/.test(v) && !SENSITIVE_KEY.test(k)) out[k] = v;
    else out[k] = "[omitted: not an id, code or count]";
  }
  return out;
}

// --- Sentry shapes (structural, so this file needs no SDK types) -----------

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const isFeedback = (event: Obj): boolean =>
  event.type === "feedback" || Boolean(event.contexts && typeof event.contexts === "object" && event.contexts.feedback);

function scrubRequest(req: Obj, opts: ScrubOptions): Obj {
  const out: Obj = { ...req };
  if (typeof out.url === "string") out.url = scrubText(stripQuery(out.url), opts);
  delete out.query_string;
  delete out.cookies;
  delete out.data; // request bodies can hold anything
  if (out.headers && typeof out.headers === "object") out.headers = scrubValue(out.headers, opts);
  return out;
}

function scrubSpanData(data: Obj, opts: ScrubOptions): Obj {
  return scrubValue(data, opts) as Obj;
}

function scrubSpan(span: Obj, opts: ScrubOptions): Obj {
  const out: Obj = { ...span };
  if (typeof out.description === "string") out.description = scrubText(stripUrlsInText(out.description), opts);
  if (out.data && typeof out.data === "object") out.data = scrubSpanData(out.data, opts);
  if (out.attributes && typeof out.attributes === "object") out.attributes = scrubSpanData(out.attributes, opts);
  if (out.tags && typeof out.tags === "object") out.tags = scrubValue(out.tags, opts);
  return out;
}

function scrubUser(user: Obj, opts: ScrubOptions): Obj {
  if (opts.keepContact) return scrubValue(user, opts) as Obj;
  // Identity is an id and nothing else on every non-feedback event.
  const out: Obj = {};
  if (user.id !== undefined) out.id = scrubValue(user.id, opts);
  return out;
}

/** Scrub the fields common to errors and transactions. Mutation-free on the input. */
function scrubCommon(event: Obj, opts: ScrubOptions): Obj {
  const out: Obj = { ...event };
  if (typeof out.message === "string") out.message = scrubText(out.message, opts);
  if (typeof out.transaction === "string") out.transaction = scrubText(stripUrlsInText(out.transaction), opts);
  if (typeof out.server_name === "string") delete out.server_name;
  if (out.logentry && typeof out.logentry === "object") {
    out.logentry = { ...out.logentry, message: typeof out.logentry.message === "string" ? scrubText(out.logentry.message, opts) : out.logentry.message };
    if (out.logentry.params) out.logentry.params = scrubValue(out.logentry.params, opts);
  }
  if (out.exception?.values && Array.isArray(out.exception.values)) {
    out.exception = {
      ...out.exception,
      values: out.exception.values.map((v: Obj) => ({
        ...v,
        value: typeof v.value === "string" ? scrubText(v.value, opts) : v.value,
      })),
    };
  }
  if (out.request && typeof out.request === "object") out.request = scrubRequest(out.request, opts);
  if (out.user && typeof out.user === "object") out.user = scrubUser(out.user, opts);
  for (const key of ["extra", "tags", "contexts"] as const) {
    if (out[key] && typeof out[key] === "object") out[key] = scrubValue(out[key], opts);
  }
  if (Array.isArray(out.breadcrumbs)) {
    out.breadcrumbs = out.breadcrumbs.slice(-MAX_ITEMS).map((b: Obj) => scrubBreadcrumbUnsafe(b, opts));
  }
  return out;
}

function scrubBreadcrumbUnsafe(crumb: Obj, opts: ScrubOptions = {}): Obj {
  const out: Obj = { ...crumb };
  if (typeof out.message === "string") out.message = scrubText(out.message, opts);
  if (out.data && typeof out.data === "object") out.data = scrubValue(out.data, opts);
  return out;
}

function scrubEventUnsafe(event: Obj): Obj {
  if (!isFeedback(event)) {
    const out = scrubCommon(event, {});
    if (out.contexts?.feedback) delete out.contexts.feedback;
    return out;
  }
  // Feedback: the reporter's own contexts.feedback (name, email, message) and
  // user are kept verbatim. Everything else (breadcrumbs, request, tags, extra,
  // other contexts) gets the normal full scrub, so feedback is never a bypass.
  const feedback = event.contexts?.feedback;
  const user = event.user;
  const rest: Obj = { ...event, contexts: { ...event.contexts } };
  delete rest.contexts.feedback;
  delete rest.user;
  const out = scrubCommon(rest, {});
  out.contexts = { ...out.contexts, feedback };
  if (user !== undefined) out.user = user;
  return out;
}

function scrubTransactionUnsafe(event: Obj): Obj {
  const opts: ScrubOptions = {};
  const out = scrubCommon(event, opts);
  if (Array.isArray(out.spans)) out.spans = out.spans.map((s: Obj) => scrubSpan(s, opts));
  const traceData = out.contexts?.trace?.data;
  if (traceData && typeof traceData === "object") {
    out.contexts = { ...out.contexts, trace: { ...out.contexts.trace, data: scrubSpanData(traceData, opts) } };
  }
  return out;
}

function scrubLogUnsafe(log: Obj): Obj {
  const out: Obj = { ...log };
  if (typeof out.message === "string") out.message = scrubText(out.message);
  else if (out.message !== undefined && out.message !== null) out.message = scrubValue(out.message);
  if (out.attributes && typeof out.attributes === "object") out.attributes = scrubValue(out.attributes);
  return out;
}

/** Wrap a scrubber so a throw drops the item (null) instead of leaking it. */
export function failClosed<T, R>(fn: (item: T) => R, onFail?: (err: unknown) => void): (item: T) => R | null {
  return (item) => {
    try {
      return fn(item);
    } catch (err) {
      try { onFail?.(err); } catch { /* reporting a scrub failure must not throw either */ }
      return null;
    }
  };
}

/** `beforeSend`: scrub an error event, or drop it. Feedback keeps name/email. */
export const scrubEvent = <T extends object>(event: T): T | null =>
  failClosed((e: T) => scrubEventUnsafe(e as Obj) as T)(event);

/** `beforeSendTransaction`: scrub a transaction and its spans, or drop it. */
export const scrubTransaction = <T extends object>(event: T): T | null =>
  failClosed((e: T) => scrubTransactionUnsafe(e as Obj) as T)(event);

/** `beforeBreadcrumb`: scrub message + data (query strings stripped), or drop it. */
export const scrubBreadcrumb = <T extends object>(crumb: T): T | null =>
  failClosed((c: T) => scrubBreadcrumbUnsafe(c as Obj) as T)(crumb);

/** `beforeSendLog`: scrub message + attributes, or drop the log. */
export const scrubLog = <T extends object>(log: T): T | null =>
  failClosed((l: T) => scrubLogUnsafe(l as Obj) as T)(log);

/** The four hooks every `Sentry.init` in the repo spreads in. */
export const sentryScrubHooks = {
  beforeSend: scrubEvent,
  beforeSendTransaction: scrubTransaction,
  beforeBreadcrumb: scrubBreadcrumb,
  beforeSendLog: scrubLog,
} as const;
