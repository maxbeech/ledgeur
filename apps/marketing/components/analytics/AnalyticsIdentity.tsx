"use client";

// Sets the oh_user_ref / oh_plan user properties once somebody is signed in, so
// every later event (and the ones fired after a sign-in on this page) carries
// them. Renders nothing.

import { useEffect } from "react";
import { analyticsEnabled } from "../../../../lib/openhelm-analytics";
import { useSession } from "@/lib/useSession";
import { syncAnalyticsIdentity } from "./identity-client";

export default function AnalyticsIdentity() {
  const { session } = useSession();
  const userId = session?.user.id;

  useEffect(() => {
    if (analyticsEnabled && userId) void syncAnalyticsIdentity();
  }, [userId]);

  return null;
}
