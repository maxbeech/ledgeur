// Pure auth helpers: what the server says a project supports, and what a person
// should read when sign-in fails. No React, no DOM, no browser globals — so the
// test suite can exercise every branch.
//
// Shared by the app and the website. Both sign in against the same Supabase
// project, so an error like "email not confirmed" has to read identically in
// both places; two copies of this file would drift into two different products
// explaining the same failure differently.

/** External providers the app offers a button for. */
export const OAUTH_PROVIDERS = ["google", "azure"] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

export const PROVIDER_LABELS: Record<OAuthProvider, string> = {
  google: "Google",
  azure: "Microsoft",
};

/** What a project's GoTrue instance actually has switched on. */
export interface AuthCapabilities {
  /** Email + password (and email links) are enabled. */
  email: boolean;
  /** New accounts may be created at all. */
  signupsAllowed: boolean;
  /** Accounts are usable immediately, without clicking a confirmation email. */
  autoConfirm: boolean;
  /** Only the providers actually configured server-side. */
  providers: OAuthProvider[];
  /**
   * SAML single sign-on is switched on for this project.
   *
   * Separate from `providers` because it works differently in every way that
   * matters to the UI: there is no button per identity provider, the user types
   * a work email or domain and the server decides where to send them, and which
   * domains are registered is not something the client can enumerate.
   */
  sso: boolean;
}

/** Nothing works — the safe assumption before/without a settings response. */
export const NO_AUTH: AuthCapabilities = { email: false, signupsAllowed: false, autoConfirm: false, providers: [], sso: false };

/**
 * Parse GET /auth/v1/settings. Anything missing is treated as "off" rather than
 * guessed, so the UI never offers a button that cannot work.
 */
export function parseAuthSettings(raw: unknown): AuthCapabilities {
  const s = (raw ?? {}) as Record<string, unknown>;
  const external = (s.external ?? {}) as Record<string, unknown>;
  return {
    email: external.email === true,
    signupsAllowed: s.disable_signup !== true,
    autoConfirm: s.mailer_autoconfirm === true,
    providers: OAUTH_PROVIDERS.filter((p) => external[p] === true),
    // GoTrue has reported this in two places across versions; treat either as
    // "on" rather than picking one and silently hiding SSO for half of them.
    sso: external.saml === true || s.saml_enabled === true,
  };
}

/**
 * The domain to hand Supabase for an SSO sign-in, or an error.
 *
 * Accepts either a work email or a bare domain, because people type both and
 * the difference is not one they should have to think about. Deliberately does
 * NOT try to guess whether the domain is registered for SSO — only the server
 * knows that, and pretending otherwise would reject valid domains.
 */
export function ssoDomain(input: string): { domain: string } | { error: string } {
  const value = input.trim().toLowerCase();
  if (!value) return { error: "Enter your work email address." };
  const domain = value.includes("@") ? value.slice(value.lastIndexOf("@") + 1) : value;
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(domain)) {
    return { error: "That doesn't look like a work email address or domain." };
  }
  return { domain };
}

/** True when no sign-in method at all is configured on the backend. */
export const hasNoAuthMethod = (c: AuthCapabilities) => !c.email && c.providers.length === 0;

/**
 * Explain an auth failure in terms the person can act on, keeping the server's
 * own wording when it is already clear. Never invents a cause.
 */
export function authErrorMessage(err: unknown): string {
  const raw = String((err && (err as { message?: string }).message) || err || "").trim();
  const lower = raw.toLowerCase();

  if (/invalid login credentials|invalid_credentials/.test(lower)) {
    return "That email and password don’t match an account. Check the password, or create an account instead.";
  }
  if (/email not confirmed|email_not_confirmed/.test(lower)) {
    return "Confirm your email address first — open the link we sent you, then sign in.";
  }
  if (/user already registered|already been registered|user_already_exists/.test(lower)) {
    return "An account already exists for that email. Sign in instead, or reset your password.";
  }
  if (/password should be at least|weak.?password|password_too_short/.test(lower)) {
    return `Choose a longer password — at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (/signups not allowed|signup_disabled|signups are disabled/.test(lower)) {
    return "New accounts are disabled on this workspace. Ask an admin to invite you.";
  }
  if (/email rate limit|over_email_send_rate_limit|rate limit exceeded/.test(lower)) {
    return "Too many emails sent just now. Wait a few minutes and try again.";
  }
  if (/error sending confirmation|error sending recovery|smtp|failed to send/.test(lower)) {
    return "The account was accepted but the email couldn’t be sent — the backend’s email provider isn’t set up. Contact support.";
  }
  if (/provider is not enabled|unsupported provider|validation_failed/.test(lower)) {
    return "That sign-in method isn’t enabled on this backend yet.";
  }
  if (/failed to fetch|networkerror|load failed|fetch failed/.test(lower)) {
    return "Couldn’t reach the server. Check your connection and try again.";
  }
  return raw || "Sign-in failed.";
}

/** Message for an OAuth provider the backend hasn't configured. */
export const providerUnavailableMessage = (p: OAuthProvider) =>
  `${PROVIDER_LABELS[p]} sign-in isn’t enabled on this backend yet. Use email and password, or ask an admin to enable it.`;

export const MIN_PASSWORD_LENGTH = 8;

/** Client-side check so obvious mistakes never cost a network round-trip. */
export function validateCredentials(email: string, password: string): string {
  if (!email.trim()) return "Enter your email address.";
  // Deliberately permissive: the server is the authority on what an address is.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return "That doesn’t look like an email address.";
  if (!password) return "Enter your password.";
  if (password.length < MIN_PASSWORD_LENGTH) return `Choose a longer password — at least ${MIN_PASSWORD_LENGTH} characters.`;
  return "";
}

/** What to tell someone after a successful sign-up, given the project's config. */
export function signUpNextStep(c: AuthCapabilities): string {
  return c.autoConfirm
    ? "Account created — you’re signed in."
    : "Account created. Open the confirmation link we emailed you, then sign in here.";
}
