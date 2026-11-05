"use client";

// Reports free_user once per browser, on the first load of the web app.
// Renders nothing. See lib/first-free-use.ts for the once-per-browser rule.

import { useEffect } from "react";
import { emit } from "@/lib/analytics-events";
import { claimFirstFreeUse } from "@/lib/first-free-use";

export default function FirstFreeUse() {
  useEffect(() => {
    try {
      if (claimFirstFreeUse(window.localStorage)) emit("free_user", { source: "web" });
    } catch {
      // Storage refused (private mode, blocked cookies). Report nothing rather
      // than on every load, since the once-per-browser mark cannot be kept.
    }
  }, []);
  return null;
}
