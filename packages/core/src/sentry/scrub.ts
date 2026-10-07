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
function scrubTextCore(text: string, opts: ScrubOptions = {}): string {
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
function scrubValueCore(value: unknown, opts: ScrubOptions = {}, depth = 0): unknown {
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

// ---------------------------------------------------------------------------
// Hardening layer (SENTRY_STANDARD section 2). Wraps the pattern table above so
// that bounded-repetition limits, truncation, encodings and per-repo gaps cannot
// leak a secret:
//  1. the string is cut to a safe window FIRST, dropping any half-cut token
//     (a secret's head must never survive a truncation boundary);
//  2. percent-encoded delimiters are decoded so `token%3Dabc` and `Bearer%20abc`
//     match like their plain forms, and URL query strings are dropped;
//  3. long JWTs, bearer tokens, vendor keys and key=value secrets are redacted
//     with open-ended (but still linear-time) patterns, so a secret longer than
//     any bounded limit in the table is redacted whole, not just its first part;
//  4. any run of token characters left glued to a redaction marker (the tail of
//     a secret that overran a bounded pattern) is swallowed into the marker;
//  5. every event / breadcrumb / log gets a second, repo-independent deep pass
//     (secret key names, URL queries, stack-frame vars, spans, contexts) and the
//     wrappers fail closed: a throw drops the item, never sends it raw. A feedback
//     event keeps ONLY the reporter's own contexts.feedback and user.
// ---------------------------------------------------------------------------
const HARDEN_MAX_CHARS = 9_900;
const HARDEN_MARK = "[redacted]";
// Characters a token cannot contain: a cut right after one is a clean cut.
const HARDEN_DELIM_RE = /[\s,;"'()[\]{}<>=:&|/?#\\]/;
// Digits and separators: the head of a phone number must not survive a cut.
const HARDEN_PHONEISH_RE = /[\d\s().+-]/;

/** Cut to the matching budget without leaving the head of a secret behind. */
function hardenWindow(s: string): string {
  if (s.length <= HARDEN_MAX_CHARS) return s;
  let end = HARDEN_MAX_CHARS;
  // Cut landed inside a token: drop the whole partial token.
  if (!HARDEN_DELIM_RE.test(s.charAt(end))) {
    while (end > 0 && !HARDEN_DELIM_RE.test(s.charAt(end - 1))) end--;
  }
  while (end > 0 && HARDEN_PHONEISH_RE.test(s.charAt(end - 1))) end--;
  return end === 0 ? `${HARDEN_MARK}...[truncated]` : `${s.slice(0, end)}...[truncated]`;
}

const HARDEN_PCT_RE = /%(?:40|20|2[BbCcFf]|3[AaDd]|26|22|27)/g;
// No lookbehind anywhere below: older WKWebView / Safari reject it at parse time.
const HARDEN_JWT_RE = /(^|[^A-Za-z0-9])eyJ[\w-]{5,}(?:\.[\w-]*){0,2}/g;
const HARDEN_BEARER_RE = /\bBearer(?:\s|\+){1,4}[\w\-.~+/=%]{8,}/gi;
const HARDEN_KEY_RE =
  /(^|[^A-Za-z0-9])(?:sk|pk|rk|whsec|hlm_sk|hlm_pk|sntrys|sntryu|sbp|sb_secret|sb_publishable|ghp|gho|ghs|ghu|ghr|github_pat|xox[abprs]|AIza)[_-][\w=+/-]{8,}/g;
const HARDEN_AUTH_RE =
  /(\bauthorization["']?\s{0,3}(?:[:=]|%3[AaDd])\s{0,3}\\?["']?)(?!(?:(?:Bearer|Basic|Token|Digest|Negotiate)(?:\s|\+|%20){1,4})?\[[A-Za-z-]{2,12}\](?![\w=+/%~.-]))(?:(?:Bearer|Basic|Token|Digest|Negotiate)(?:\s|\+|%20){1,4})?[^\s,;&}"'\\]+/gi;
const HARDEN_KV_KEY =
  "((?:password|passwd|passphrase|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|credential|cookie|signature|jwt|dsn)[\\w.-]{0,30}\\\\?[\"']?\\s{0,3}(?:[:=]|%3[AaDd])\\s{0,3})";
// Quoted values keep their quotes so serialised JSON stays valid.
const HARDEN_KV_ESC_RE = new RegExp(`${HARDEN_KV_KEY}\\\\"(?!\\[[A-Za-z-]{2,12}\\]\\\\")[^"\\\\]*\\\\"`, "gi");
const HARDEN_KV_DQ_RE = new RegExp(`${HARDEN_KV_KEY}"(?!\\[[A-Za-z-]{2,12}\\]")(?:[^"\\\\]|\\\\.)*"`, "gi");
const HARDEN_KV_SQ_RE = new RegExp(`${HARDEN_KV_KEY}'(?!\\[[A-Za-z-]{2,12}\\]')(?:[^'\\\\]|\\\\.)*'`, "gi");
const HARDEN_KV_RAW_RE = new RegExp(`${HARDEN_KV_KEY}(?!\\[[A-Za-z-]{2,12}\\](?![\\w=+/%~.-]))[^\\s,;&}"'\\\\]+`, "gi");
const HARDEN_EMAIL_RE = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){1,8}/g;
const HARDEN_URLCRED_RE = /\b([a-z][a-z0-9+.-]{1,15}:\/\/)[^\s/@:]{1,200}:(?!\[[A-Za-z-]{2,12}\]@)[^\s/@]{1,500}@/gi;
const HARDEN_PHONE_RE = /(^|[^\w.-])((?:\+|0)(?![0-9a-f]{7}-[0-9a-f]{4}-)\d[\d\s().-]{7,18}\d)(?![\w])/gi;
const HARDEN_NANP_RE = /(^|[^\w.-])(\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4})(?![\w])/g;
// Query strings and fragments carry capability tokens: keep scheme+host+path only.
const HARDEN_URLQ_RE = /(https?:\/\/[^\s"'<>?#]{1,2000})\?(?!\[[A-Za-z-]{2,12}\](?:$|[\s"'<>]))(?:[^\s"'<>]{0,4000}=\s\[[A-Za-z-]{2,12}\]|[^\s"'<>]{0,4000})/gi;
const HARDEN_PATHQ_RE = /(^|[\s"'(])(\/[^\s"'<>?#]{0,2000})\?(?!\[[A-Za-z-]{2,12}\](?:$|[\s"'<>]))(?:[^\s"'<>]{0,4000}=\s\[[A-Za-z-]{2,12}\]|[^\s"'<>]{0,4000})/g;
// Fragments carry tokens too (OAuth implicit flow, magic links): only a strict routing fragment may stay.
const HARDEN_URLF_RE = /(https?:\/\/[^\s"'<>?#]{1,2000})#(?!\/[A-Za-z0-9_/-]{0,64}(?:$|[\s"'<>]))[^\s"'<>]{0,4000}/gi;
const HARDEN_PATHF_RE = /(^|[\s"'(])(\/[^\s"'<>?#]{0,2000})#(?!\/[A-Za-z0-9_/-]{0,64}(?:$|[\s"'<>]))[^\s"'<>]{0,4000}/g;
const HARDEN_TAIL_RE = /(\[redacted\]|\[[A-Za-z][A-Za-z-]{1,14}\])(?:[\w=+/%~-]|\.(?=\w))+/g;
// Same, when the repo wraps its marker in quotes (`"[redacted]"tail`).
const HARDEN_TAILQ_RE = /(\[redacted\]|\[[A-Za-z][A-Za-z-]{1,14}\])(["']\]?)(?:[\w=+/%~-]|\.(?=\w))+/g;
// A scheme-only redaction (`Authorization: Basic abc...` -> `[redacted] abc...`) leaves the credential itself behind.
const HARDEN_AUTHTAIL_RE = /(\[redacted\])\s{1,4}(?=[A-Za-z0-9+/=._~-]*[0-9])[A-Za-z0-9+/=._~-]{20,}/g;
const HARDEN_DECODE: Record<string, string> = {
  "%40": "@", "%20": " ", "%2b": "+", "%2c": ",", "%2f": "/", "%3a": ":", "%3d": "=", "%26": "&", "%22": '"', "%27": "'",
};

function hardenPre(input: string): string {
  return hardenRedact(input, true);
}

/** Module-private: only the reporter's own feedback message is run with `redactContact` false (secrets still go). */
function hardenRedact(input: string, redactContact: boolean): string {
  // Query strings first: decoding `%20` would otherwise end the URL early and leave the rest behind.
  let s = input.replace(HARDEN_URLQ_RE, "$1").replace(HARDEN_PATHQ_RE, "$1$2").replace(HARDEN_URLF_RE, "$1").replace(HARDEN_PATHF_RE, "$1$2");
  if (s.includes("%")) s = s.replace(HARDEN_PCT_RE, (m) => HARDEN_DECODE[m.toLowerCase()] ?? m);
  return s
    .replace(HARDEN_URLCRED_RE, `$1${HARDEN_MARK}@`)
    .replace(HARDEN_EMAIL_RE, redactContact ? HARDEN_MARK : "$&")
    .replace(HARDEN_JWT_RE, `$1${HARDEN_MARK}`)
    .replace(HARDEN_BEARER_RE, HARDEN_MARK)
    .replace(HARDEN_AUTH_RE, `$1${HARDEN_MARK}`)
    .replace(HARDEN_KEY_RE, `$1${HARDEN_MARK}`)
    .replace(HARDEN_KV_ESC_RE, `$1\\"${HARDEN_MARK}\\"`)
    .replace(HARDEN_KV_DQ_RE, `$1"${HARDEN_MARK}"`)
    .replace(HARDEN_KV_SQ_RE, `$1'${HARDEN_MARK}'`)
    .replace(HARDEN_KV_RAW_RE, `$1${HARDEN_MARK}`)
    .replace(HARDEN_PHONE_RE, (m, pre: string, num: string) => (redactContact && num.replace(/\D/g, "").length >= 9 ? `${pre}${HARDEN_MARK}` : m))
    .replace(HARDEN_NANP_RE, redactContact ? `$1${HARDEN_MARK}` : "$&");
}

function hardenPost(s: string): string {
  return s.replace(HARDEN_TAIL_RE, "$1").replace(HARDEN_TAILQ_RE, "$1$2").replace(HARDEN_AUTHTAIL_RE, "$1");
}

/**
 * Mask secrets, tokens, emails, phone numbers and URL query strings in free text.
 * Extra arguments (modes, options, `true`) are deliberately ignored: nothing a caller passes can switch
 * redaction off. A feedback reporter's own fields are restored at event level instead (see hardenEvent).
 */
export function scrubText(input: string, ..._ignored: unknown[]): string {
  const core = scrubTextCore as (s: string) => string;
  // Cut first, then the repo's own scrubber (its output shapes are unchanged), then the open-ended
  // passes for whatever its bounded patterns missed, then swallow any tail left glued to a marker.
  return hardenPost(hardenPre(core(hardenWindow(input))));
}

// Key names that carry secrets whatever the repo-specific table above says.
const HARDEN_SECRET_KEY_RE =
  /passw(?:or)?d|passwd|pwd|passphrase|secret|token|api[-_. ]?key|apikey|access[-_.]?key|private[-_.]?key|authorization|cookie|credential|signature|dsn|jwt|bearer|session|otp|(?:^|[-_.])(?:auth|key|sig)(?:$|[-_.])/i;

// `api_key_id`, `token_id`: identifiers of a credential, not the credential.
// `auth_method` and friends describe the scheme, they do not carry it.
const HARDEN_ID_KEY_RE = /(?:(?:key|token|secret)[-_.]?ids?|(?:^|[-_.])auth[-_.](?:method|type|provider|mode|scheme|status))$/i;

function hardenIsSecretEntry(k: string, val: unknown): boolean {
  return HARDEN_SECRET_KEY_RE.test(k) && !HARDEN_ID_KEY_RE.test(k) && val != null && typeof val !== "number" && typeof val !== "boolean";
}

/** Recursively redact sensitive values, preserving structure for debugging. */
export function scrubValue(value: unknown, ...rest: unknown[]): unknown {
  const core = scrubValueCore as (v: unknown, ...r: unknown[]) => unknown;
  let v: unknown = value;
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const entries = Object.entries(v as Record<string, unknown>);
    if (entries.some(([k, val]) => hardenIsSecretEntry(k, val))) {
      const copy: Record<string, unknown> = {};
      for (const [k, val] of entries) copy[k] = hardenIsSecretEntry(k, val) ? HARDEN_MARK : val;
      v = copy;
    }
  }
  return core(v, ...rest);
}

type HardenBag = Record<string, unknown>;
type HardenState = { n: number; seen: WeakSet<object> };
const HARDEN_URL_KEYS = new Set(["url", "to", "from", "href", "http.url", "url.full", "http.target", "referrer", "referer", "origin"]);
const HARDEN_QUERY_KEYS = new Set(["url.query", "http.query", "query", "query_string", "http.fragment", "search"]);
const HARDEN_MAX_NODES = 20_000;

function hardenStripQuery(url: string): string {
  // Cut at the first `?` or `#`. Only a strict routing fragment (`#/some/route`) may stay, and never after a query.
  const i = url.search(/[?#]/);
  if (i === -1) return url;
  if (url.charAt(i) === "#" && /^#\/[A-Za-z0-9_/-]{0,64}$/.test(url.slice(i))) return url;
  return url.slice(0, i);
}

/** Deep, idempotent pass: secret keys, URL queries, every string through the scrubber. */
function hardenValue(value: unknown, state: HardenState, depth = 0, key = ""): unknown {
  if (value == null) return value;
  if (typeof value === "string") return scrubText(key && HARDEN_URL_KEYS.has(key) ? hardenStripQuery(value) : value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value !== "object") return undefined; // functions, symbols
  if (value instanceof Date) return value;
  if (state.seen.has(value) || depth > 10 || ++state.n > HARDEN_MAX_NODES) return HARDEN_MARK;
  state.seen.add(value);
  try {
    if (Array.isArray(value)) return value.map((v) => hardenValue(v, state, depth + 1, key));
    const out: HardenBag = {};
    for (const [k, v] of Object.entries(value as HardenBag)) {
      const lk = k.toLowerCase();
      if (HARDEN_QUERY_KEYS.has(lk) && v != null && v !== "") out[k] = HARDEN_MARK;
      else if (!lk.startsWith("sentry.") && hardenIsSecretEntry(k, v)) out[k] = HARDEN_MARK;
      else out[k] = hardenValue(v, state, depth + 1, lk);
    }
    return out;
  } finally {
    state.seen.delete(value);
  }
}

function hardenFresh(): HardenState {
  return { n: 0, seen: new WeakSet<object>() };
}

type HardenReporter = { feedback: HardenBag; user: HardenBag } | undefined;
const HARDEN_REPORTER_FEEDBACK_KEYS = ["name", "email", "contact_email", "message"];
const HARDEN_REPORTER_USER_KEYS = ["email", "name"];

/** The reporter's own words, read from the ORIGINAL feedback event before anything scrubs it. */
function hardenReporter(event: unknown): HardenReporter {
  try {
    const ev = event as HardenBag | null;
    if (!ev || typeof ev !== "object") return undefined;
    const fb = (ev.contexts as HardenBag | undefined)?.feedback;
    if (ev.type !== "feedback" && !fb) return undefined;
    const pick = (src: unknown, keys: string[]): HardenBag => {
      const out: HardenBag = {};
      if (src && typeof src === "object") for (const k of keys) {
        const v = (src as HardenBag)[k];
        if (typeof v === "string") out[k] = k === "message" ? hardenPost(hardenRedact(hardenWindow(v), false)) : v;
      }
      return out;
    };
    return { feedback: pick(fb, HARDEN_REPORTER_FEEDBACK_KEYS), user: pick(ev.user, HARDEN_REPORTER_USER_KEYS) };
  } catch {
    return undefined;
  }
}

/**
 * Second, repo-independent pass over every free-text and structured field of an event. EVERYTHING is
 * scrubbed, feedback events included; afterwards the reporter's own contexts.feedback name/email/message
 * and user email/name are copied back from the original event. Breadcrumbs, request, tags, extra, other
 * contexts and every other field of the same event stay fully scrubbed.
 */
function hardenEvent<T>(event: T, reporter?: HardenReporter): T {
  const ev = event as unknown as HardenBag;
  const st = hardenFresh();
  for (const k of ["message", "logentry", "request", "extra", "tags", "breadcrumbs", "transaction", "spans", "user"]) {
    if (ev[k] != null) ev[k] = hardenValue(ev[k], st, 0, k);
  }
  const contexts = ev.contexts as HardenBag | undefined;
  if (contexts) {
    const trace = contexts.trace as HardenBag | undefined;
    const next: HardenBag = {};
    for (const [ck, cv] of Object.entries(contexts)) {
      if (ck === "trace" && trace) next[ck] = { ...trace, data: hardenValue(trace.data, st, 0, "data") };
      else next[ck] = hardenValue(cv, st, 0, ck);
    }
    ev.contexts = next;
  }
  if (reporter) {
    if (Object.keys(reporter.feedback).length) {
      const ctx = (ev.contexts as HardenBag | undefined) ?? {};
      ctx.feedback = { ...((ctx.feedback as HardenBag | undefined) ?? {}), ...reporter.feedback };
      ev.contexts = ctx;
    }
    if (Object.keys(reporter.user).length) ev.user = { ...((ev.user as HardenBag | undefined) ?? {}), ...reporter.user };
  }
  const exc = ev.exception as { values?: HardenBag[] } | undefined;
  for (const x of exc?.values ?? []) {
    if (typeof x.value === "string") x.value = scrubText(x.value);
    const frames = (x.stacktrace as { frames?: HardenBag[] } | undefined)?.frames ?? [];
    for (const f of frames) if (f.vars != null) f.vars = hardenValue(f.vars, st, 0, "vars");
    const mech = x.mechanism as HardenBag | undefined;
    if (mech?.data != null) mech.data = hardenValue(mech.data, st, 0, "data");
  }
  return event;
}

/** Deep pass for a breadcrumb or log record (message + data/attributes). */
function hardenRecord<T>(rec: T): T {
  return hardenValue(rec, hardenFresh()) as T;
}

/** scrubEvent, then the deep hardening pass. Fails closed: a throw drops the item, never sends it raw. */
export const scrubEvent: typeof scrubEventCore = ((...args: unknown[]) => {
  try {
    const reporter = hardenReporter(args[0]);
    const out = (scrubEventCore as unknown as (...a: unknown[]) => unknown)(...args);
    return out ? hardenEvent(out, reporter) : null;
  } catch {
    return null;
  }
}) as unknown as typeof scrubEventCore;

/** scrubTransaction, then the deep hardening pass. Fails closed: a throw drops the item, never sends it raw. */
export const scrubTransaction: typeof scrubTransactionCore = ((...args: unknown[]) => {
  try {
    const reporter = hardenReporter(args[0]);
    const out = (scrubTransactionCore as unknown as (...a: unknown[]) => unknown)(...args);
    return out ? hardenEvent(out, reporter) : null;
  } catch {
    return null;
  }
}) as unknown as typeof scrubTransactionCore;

/** scrubBreadcrumb, then the deep hardening pass. Fails closed: a throw drops the item, never sends it raw. */
export const scrubBreadcrumb: typeof scrubBreadcrumbCore = ((...args: unknown[]) => {
  try {
    const out = (scrubBreadcrumbCore as unknown as (...a: unknown[]) => unknown)(...args);
    return out ? hardenRecord(out) : null;
  } catch {
    return null;
  }
}) as unknown as typeof scrubBreadcrumbCore;

/** scrubLog, then the deep hardening pass. Fails closed: a throw drops the item, never sends it raw. */
export const scrubLog: typeof scrubLogCore = ((...args: unknown[]) => {
  try {
    const out = (scrubLogCore as unknown as (...a: unknown[]) => unknown)(...args);
    return out ? hardenRecord(out) : null;
  } catch {
    return null;
  }
}) as unknown as typeof scrubLogCore;


/** `beforeSend`: scrub an error event, or drop it. Feedback keeps name/email. */
const scrubEventCore = <T extends object>(event: T): T | null =>
  failClosed((e: T) => scrubEventUnsafe(e as Obj) as T)(event);

/** `beforeSendTransaction`: scrub a transaction and its spans, or drop it. */
const scrubTransactionCore = <T extends object>(event: T): T | null =>
  failClosed((e: T) => scrubTransactionUnsafe(e as Obj) as T)(event);

/** `beforeBreadcrumb`: scrub message + data (query strings stripped), or drop it. */
const scrubBreadcrumbCore = <T extends object>(crumb: T): T | null =>
  failClosed((c: T) => scrubBreadcrumbUnsafe(c as Obj) as T)(crumb);

/** `beforeSendLog`: scrub message + attributes, or drop the log. */
const scrubLogCore = <T extends object>(log: T): T | null =>
  failClosed((l: T) => scrubLogUnsafe(l as Obj) as T)(log);

/** The four hooks every `Sentry.init` in the repo spreads in. */
export const sentryScrubHooks = {
  beforeSend: scrubEvent,
  beforeSendTransaction: scrubTransaction,
  beforeBreadcrumb: scrubBreadcrumb,
  beforeSendLog: scrubLog,
} as const;
