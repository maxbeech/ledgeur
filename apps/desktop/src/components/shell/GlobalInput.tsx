// The ever-present composer. One field for the whole app: it talks to the
// app copilot, or — while a meeting is recording — to that meeting's copilot.
// Pinned as a sibling of the scroll area so it never unmounts on navigation.
import { ChatComposer } from "../chat/ChatComposer.tsx";
import { useChatDock } from "../../lib/useChatDock.ts";

export function GlobalInput() {
  const dock = useChatDock();
  return (
    <div className="shrink-0 px-3 pb-3 pt-1 sm:px-6 sm:pb-4">
      <div className="mx-auto max-w-3xl">
        <ChatComposer
          onSend={(text, q) => dock.send(text, q)}
          busy={dock.busy}
          quote={dock.quote}
          onClearQuote={() => dock.setQuote(null)}
          placeholder={dock.recording ? "Ask about this meeting, or reply to a line" : "Ask across your meetings and tools"}
        />
      </div>
    </div>
  );
}
