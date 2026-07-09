// The ever-present bottom input. One field for the whole app: it talks to the
// app copilot, or — while a meeting is recording — to that meeting's copilot.
// Pinned as a sibling of the scroll area so it never unmounts on navigation.
import { ChatComposer } from "../chat/ChatComposer.tsx";
import { useChatDock } from "../../lib/useChatDock.ts";

export function GlobalInput() {
  const dock = useChatDock();
  return (
    <div className="shrink-0 pb-[64px] md:pb-0">
      <ChatComposer
        onSend={(text, q) => dock.send(text, q)}
        busy={dock.busy}
        quote={dock.quote}
        onClearQuote={() => dock.setQuote(null)}
        placeholder={dock.recording ? "Ask the meeting copilot, or reply to a line…" : "Ask across your company brain…"}
      />
    </div>
  );
}
