// Split out of recorderContext.tsx: a file exporting both a component and a
// hook breaks Vite Fast Refresh (full remount instead of a hot update), which
// is what was resetting in-progress recordings during dev.

import { useContext } from "react";
import { RecorderCtx, type RecorderApi } from "./recorderContext.tsx";

export function useRecorderCtx(): RecorderApi {
  const ctx = useContext(RecorderCtx);
  if (!ctx) throw new Error("useRecorderCtx must be used inside <RecorderProvider>.");
  return ctx;
}
