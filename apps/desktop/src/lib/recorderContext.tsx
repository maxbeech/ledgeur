// App-level recorder. Lifting useRecorder out of the Record screen means a
// recording keeps running while the user browses other screens — the sidebar
// shows a live pill that links back. The provider unmounts only when the app
// closes, which is when the hook's cleanup (mic/worker teardown) should run.
//
// The meeting *thread* (copilot answers, the user's questions, proactive
// suggestions) is composed here too, so it survives navigation and can be saved
// with the recording. It merges with the transcript into one conversation.

import { createContext, useEffect, useRef, useState, type ReactNode } from "react";
import { formatTranscript } from "@ledgeur/core";
import { useRecorder } from "./useRecorder.ts";
import { useMeetingThread } from "./useMeetingThread.ts";
import { gatherMeetingContext, toTranscriptLines } from "./meetingContext.ts";
import { warmupModels } from "./modelWarmup.ts";
import { isPhoneOs } from "./platform.ts";
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

  // RecorderProvider mounts once for the app's whole lifetime (see the header
  // comment above), so this fires exactly once per launch — as early as the
  // model is ever going to be needed.
  // A laptop warms the speech model at launch so the first recording starts
  // instantly. A phone does not: the download is tens of megabytes and the
  // connection may be metered, so it waits for the first tap on Record.
  useEffect(() => { if (!isPhoneOs()) warmupModels(); }, []);

  const stateRef = useRef(recorder.state);
  stateRef.current = recorder.state;
  const titleRef = useRef(title);
  titleRef.current = title;
  // Speaker-labelled and timed, not a flat join: the proactive coach reads the
  // same transcript the copilot does, and "who said it" changes what is worth
  // suggesting next.
  const transcriptText = () => formatTranscript(toTranscriptLines(stateRef.current.segments));

  const thread = useMeetingThread({
    gather: (question) =>
      gatherMeetingContext({
        question,
        title: titleRef.current,
        lines: toTranscriptLines(stateRef.current.segments),
        notes: stateRef.current.notes,
        elapsedMs: Math.round(stateRef.current.elapsed * 1000),
      }),
    getTranscript: transcriptText,
    elapsedMs: () => Math.round(stateRef.current.elapsed * 1000),
    recording: recorder.state.status === "recording",
    takeId: recorder.state.takeId,
  });
  threadRef.current = () => thread.messages;

  return <RecorderCtx.Provider value={{ ...recorder, ...thread, title, setTitle }}>{children}</RecorderCtx.Provider>;
}
