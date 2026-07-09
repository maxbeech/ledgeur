// App-level recorder. Lifting useRecorder out of the Record screen means a
// recording keeps running while the user browses other screens — the sidebar
// shows a live pill that links back. The provider unmounts only when the app
// closes, which is when the hook's cleanup (mic/worker teardown) should run.
//
// The meeting *thread* (copilot answers, the user's questions, proactive
// suggestions) is composed here too, so it survives navigation and can be saved
// with the recording. It merges with the transcript into one conversation.

import { createContext, useRef, useState, type ReactNode } from "react";
import { useRecorder } from "./useRecorder.ts";
import { useMeetingThread } from "./useMeetingThread.ts";
import type { ChatMessage } from "./meetingsStore.ts";

export type RecorderApi = ReturnType<typeof useRecorder> &
  ReturnType<typeof useMeetingThread> & {
    /** Working meeting title — survives navigation during a recording. */
    title: string;
    setTitle: (t: string) => void;
  };

// Exported so useRecorderCtx.ts can read it — the hook lives in its own module
// because a file mixing a component export with a hook export breaks Vite Fast
// Refresh (forces a full remount instead of a state-preserving hot update,
// which drops an in-progress recording).
export const RecorderCtx = createContext<RecorderApi | null>(null);

export function RecorderProvider({ children }: { children: ReactNode }) {
  // The recorder needs the thread's messages at save time, and the thread needs
  // the recorder's live transcript/elapsed — wire them through a ref so neither
  // captures the other stale.
  const threadRef = useRef<() => ChatMessage[]>(() => []);
  const recorder = useRecorder(() => threadRef.current());
  const [title, setTitle] = useState("");

  const stateRef = useRef(recorder.state);
  stateRef.current = recorder.state;
  const transcriptText = () => stateRef.current.segments.map((s) => s.text).join(" ");

  const thread = useMeetingThread({
    getContext: () => [{ source: "Live transcript", text: transcriptText() }],
    getTranscript: transcriptText,
    elapsedMs: () => Math.round(stateRef.current.elapsed * 1000),
    recording: recorder.state.status === "recording",
    starting: recorder.state.status === "loading-model",
  });
  threadRef.current = () => thread.messages;

  return <RecorderCtx.Provider value={{ ...recorder, ...thread, title, setTitle }}>{children}</RecorderCtx.Provider>;
}
