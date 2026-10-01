// Browser half of the analytics identity: ask the server who this session is
// and tell Google Analytics. Silent on failure, since a missing identity only
// means events go out without the user properties.

import { identify } from "../../../../lib/openhelm-analytics";
import { getSupabase } from "@/lib/supabase";
import { isAnalyticsIdentity } from "@/lib/analytics-identity";

export async function syncAnalyticsIdentity(): Promise<void> {
  try {
    const sb = getSupabase();
    const { data } = (await sb?.auth.getSession()) ?? { data: { session: null } };
    const token = data.session?.access_token;
    if (!token) return;
    const res = await fetch("/api/analytics/identity", { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return;
    const body: unknown = await res.json();
    if (isAnalyticsIdentity(body)) identify(body);
  } catch {
    /* analytics must never get in a user's way */
  }
}
