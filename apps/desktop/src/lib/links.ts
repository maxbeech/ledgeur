// Single source of truth for external links used by the app.
const SITE = import.meta.env.VITE_SITE_URL ?? "https://ledgeur.com";
export const SITE_PRICING_URL = `${SITE}/pricing`;
export const SITE_URL = SITE;

/** Pricing link carrying the org id so a completed checkout auto-activates the
 *  plan (see stripe-webhook). Falls back to the plain pricing URL if signed out. */
export function pricingUrlForOrg(orgId: string | null | undefined): string {
  return orgId ? `${SITE_PRICING_URL}?org=${encodeURIComponent(orgId)}` : SITE_PRICING_URL;
}
