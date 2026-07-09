// Single source of truth for the public contact address. Stored base64-encoded
// and only ever decoded at call time so the plain address never sits as
// scannable text in server-rendered HTML, API responses, or the JS bundle.
const ENCODED_CONTACT_EMAIL = "aGVsbG9AbGVkZ2V1ci5jb20=";

export function getContactEmail(): string {
  return atob(ENCODED_CONTACT_EMAIL);
}

export function contactMailto(subject?: string): string {
  const qs = subject ? `?subject=${encodeURIComponent(subject)}` : "";
  return `mailto:${getContactEmail()}${qs}`;
}
