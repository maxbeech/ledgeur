// Auto-start and the follow-up's voice — the two settings that change what the
// app does without being asked.
//
// Auto-start gets the longest explanation on this screen, and deliberately so:
// it is the only feature that can produce a recording nobody pressed a button
// for, and somebody turning it on should know exactly what it will and will not
// do before they find out from a recording.

import { CalendarClock, Mail } from "lucide-react";
import { Badge, Card, Field, Input, Label, Select, Toggle } from "../ui.tsx";
import { useSettings, setSetting } from "../../lib/settings.ts";
import { useSession } from "../../lib/session.ts";

export function AutomationCard() {
  const settings = useSettings();
  const { session } = useSession();
  const calendarConnected = Boolean(session);

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center gap-2">
        <CalendarClock className="h-4 w-4 text-brand-strong" />
        <Label>Automatic recording</Label>
        {!calendarConnected && <Badge tone="warn">Needs a calendar</Badge>}
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-base font-medium text-ink-text">Start recording when a calendar meeting begins</div>
          <p className="mt-1 max-w-xl text-xs leading-relaxed text-faint">
            Only meetings with a join link — a “Lunch” block or a focus hold is never recorded. Only within
            two minutes of the start time, so waking your laptop mid-morning cannot retroactively start
            anything. Only once per meeting, so stopping a take does not restart it. Never over a recording
            that is already running. Every automatic start opens the meeting room and fires a notification
            saying so.
          </p>
          {!calendarConnected && (
            <p className="mt-2 text-xs text-faint">Sign in with Google or Microsoft under Account to connect a calendar first.</p>
          )}
        </div>
        <Toggle
          on={settings.autoStartFromCalendar}
          disabled={!calendarConnected}
          onChange={(v) => setSetting("autoStartFromCalendar", v)}
          label="Start recording when a calendar meeting begins"
        />
      </div>

      <div className="my-5 h-px bg-hairline" />

      <div className="mb-3 flex items-center gap-2">
        <Mail className="h-4 w-4 text-brand-strong" />
        <Label>Follow-up emails</Label>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Sign off as" htmlFor="au-sender" hint="Left blank, drafts end after the last line rather than inventing a signature.">
          <Input id="au-sender" value={settings.senderName} onChange={(e) => setSetting("senderName", e.target.value)} placeholder="Your name" />
        </Field>
        <Field label="Register" htmlFor="au-tone">
          <Select id="au-tone" value={settings.followUpTone} onChange={(e) => setSetting("followUpTone", e.target.value as "warm" | "neutral" | "brief")}>
            <option value="warm">Warm — friendly, not effusive</option>
            <option value="neutral">Neutral — professional and plain</option>
            <option value="brief">Brief — scannable on a phone</option>
          </Select>
        </Field>
      </div>
    </Card>
  );
}
