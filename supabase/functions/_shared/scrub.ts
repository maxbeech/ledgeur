// Deno-side copy of the text + value scrubber in packages/core/src/sentry/scrub.ts.
// Edge functions cannot import from the workspace, so the patterns are repeated
// here; apps/marketing/test/sentry.mts pins both to identical output on a set of
// secret samples. Change them together.

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

