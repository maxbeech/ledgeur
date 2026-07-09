// Copilot behaviour during meetings: proactive suggestions and whether the
// copilot conversation is saved with the recording. Backed by the shared
// settings store, so changes take effect in the live meeting immediately.
import { MessageSquare } from "lucide-react";
import { Card, Toggle } from "../ui.tsx";
import { useSettings, setSetting } from "../../lib/settings.ts";

function Row({ title, desc, on, onChange }: { title: string; desc: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0">
        <div className="text-sm font-medium text-ink-text">{title}</div>
        <p className="mt-0.5 max-w-md text-xs leading-relaxed text-muted">{desc}</p>
      </div>
      <div className="pt-0.5"><Toggle on={on} onChange={onChange} /></div>
    </div>
  );
}

export function CopilotCard() {
  const s = useSettings();
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2">
        <MessageSquare className="h-4 w-4 text-accent-strong" />
        <span className="text-sm font-medium text-ink-text">Meeting copilot</span>
      </div>
      <div className="mt-2 divide-y divide-hairline">
        <Row
          title="Proactive suggestions"
          desc="During a meeting, the copilot occasionally posts a “you could say…” prompt into the thread, based on what's being discussed."
          on={s.proactiveSuggestions}
          onChange={(v) => setSetting("proactiveSuggestions", v)}
        />
        <Row
          title="Save copilot chat with the meeting"
          desc="Off by default — only the spoken transcript is kept when you save. Turn on to also store the copilot's answers and your questions with the meeting."
          on={s.saveChatWithMeeting}
          onChange={(v) => setSetting("saveChatWithMeeting", v)}
        />
      </div>
    </Card>
  );
}
