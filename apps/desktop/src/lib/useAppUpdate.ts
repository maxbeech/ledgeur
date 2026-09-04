// App-level update check, run once per launch (see Shell.tsx). A separate hook
// rather than folded into recorderContext.tsx — updates and meetings are
// unrelated concerns, and this one needs no thread/transcript wiring.

import { useCallback, useEffect, useRef, useState } from "react";
import { checkForUpdate, installUpdate, type AvailableUpdate, type DownloadProgress } from "./appUpdate.ts";
import { createLogger } from "./logger.ts";

const log = createLogger("app-update");

export type UpdateStatus = "idle" | "checking" | "available" | "installing" | "error";

export interface UpdateState {
  status: UpdateStatus;
  update: AvailableUpdate | null;
  progress: DownloadProgress | null;
  error: string;
}

export function useAppUpdate() {
  const [state, setState] = useState<UpdateState>({ status: "idle", update: null, progress: null, error: "" });
  const checked = useRef(false);

  useEffect(() => {
    if (checked.current) return;
    checked.current = true;
    setState((s) => ({ ...s, status: "checking" }));
    void checkForUpdate().then((update) => {
      setState((s) => (update ? { ...s, status: "available", update } : { ...s, status: "idle" }));
    });
  }, []);

  const install = useCallback(async () => {
    setState((s) => ({ ...s, status: "installing", error: "", progress: null }));
    try {
      await installUpdate((progress) => setState((s) => ({ ...s, progress })));
      // installUpdate relaunches the app on success — nothing left to do here.
    } catch (e) {
      log.error("update install failed", e);
      setState((s) => ({ ...s, status: "error", error: e instanceof Error ? e.message : String(e) }));
    }
  }, []);

  return { ...state, install };
}
