// Single source of truth for external links used by the app.
const SITE = import.meta.env.VITE_SITE_URL ?? "https://ledgeur.com";
export const SITE_URL = SITE;
export const SITE_PRICING_URL = `${SITE}/pricing`;
export const SITE_ACCOUNT_URL = `${SITE}/account`;
export const SITE_AGENTS_URL = `${SITE}/agents`;

/**
 * Where to send someone who wants to upgrade.
 *
 * This used to append `?org=<id>` because checkout took the workspace id from
 * the query string. It no longer does: the checkout route resolves the
 * workspace from the buyer's own signed-in session, which is both correct (a
 * query parameter could be edited to activate somebody else's workspace) and
 * more reliable (it cannot be lost by a redirect). The account page is now the
 * right destination — it signs them in and upgrades in one place.
 */
export function upgradeUrl(): string {
  return SITE_ACCOUNT_URL;
}
