// App-level recorder. Lifting useRecorder out of the Record screen means a
// recording keeps running while the user browses other screens — the sidebar
// shows a live pill that links back. The provider unmounts only when the app
// closes, which is when the hook's cleanup (mic/worker teardown) should run.

import { createContext, useContext, useState, type ReactNode } from "react";
import { useRecorder } from "./useRecorder.ts";

type RecorderApi = ReturnType<typeof useRecorder> & {
  /** Working meeting title — survives navigation during a recording. */
  title: string;
  setTitle: (t: string) => void;
};

const Ctx = createContext<RecorderApi | null>(null);

export function RecorderProvider({ children }: { children: ReactNode }) {
  const recorder = useRecorder();
  const [title, setTitle] = useState("");
  return <Ctx.Provider value={{ ...recorder, title, setTitle }}>{children}</Ctx.Provider>;
}

export function useRecorderCtx(): RecorderApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useRecorderCtx must be used inside <RecorderProvider>.");
  return ctx;
}
