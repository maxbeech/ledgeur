// Auto-start and the follow-up's voice — the two settings that change what the
// app does without being asked.
//
// Auto-start gets the longest explanation on this screen, and deliberately so:
// it is the only feature that can produce a recording nobody pressed a button
// for, and somebody turning it on should know exactly what it will and will not
// do before they find out from a recording.

import { CalendarClock, Mail } from "lucide-react";
import { Card, Chip, Kicker } from "../ui.tsx";
import { useSettings, setSetting } from "../../lib/settings.ts";
import { useSession } from "../../lib/session.ts";

export function AutomationCard() {
  const settings = useSettings();
  const { session } = useSession();
  const calendarConnected = Boolean(session);

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center gap-2">
        <CalendarClock className="h-4 w-4 text-accent-strong" />
        <Kicker>Automatic recording</Kicker>
        {!calendarConnected && <Chip tone="warn">needs a calendar</Chip>}
      </div>

      <label className="flex cursor-pointer items-start gap-2.5">
        <input
          type="checkbox"
          checked={settings.autoStartFromCalendar}
          disabled={!calendarConnected}
          onChange={(e) => setSetting("autoStartFromCalendar", e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-hairline-strong accent-[var(--accent-strong,#1f6f4a)] disabled:opacity-40"
        />
        <span className="text-[12.5px] leading-relaxed text-ink-text">
          Start recording when a calendar meeting begins
          <span className="mt-1 block text-[11.5px] leading-relaxed text-faint">
            Only meetings with a join link — a “Lunch” block or a focus hold is never recorded. Only within
            two minutes of the start time, so waking your laptop mid-morning cannot retroactively start
            anything. Only once per meeting, so stopping a take does not restart it. Never over a recording
            that is already running. Every automatic start opens the meeting room and fires a notification
            saying so.
          </span>
        </span>
      </label>
      {!calendarConnected && (
        <p className="mt-2 pl-6.5 text-[11px] text-faint">
          Sign in with Google or Microsoft under Account to connect a calendar first.
        </p>
      )}

      <div className="my-4 h-px bg-hairline" />

      <div className="mb-3 flex items-center gap-2">
        <Mail className="h-4 w-4 text-accent-strong" />
        <Kicker>Follow-up emails</Kicker>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="au-sender" className="ldg-kicker mb-1.5 block">Sign off as</label>
          <input
            id="au-sender"
            value={settings.senderName}
            onChange={(e) => setSetting("senderName", e.target.value)}
            placeholder="Your name"
            className="w-full rounded-lg border border-hairline bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent/40"
          />
          <p className="mt-1 text-[11px] text-faint">
            Left blank, drafts end after the last line rather than inventing a signature.
          </p>
        </div>
        <div>
          <label htmlFor="au-tone" className="ldg-kicker mb-1.5 block">Register</label>
          <select
            id="au-tone"
            value={settings.followUpTone}
            onChange={(e) => setSetting("followUpTone", e.target.value as "warm" | "neutral" | "brief")}
            className="w-full rounded-lg border border-hairline bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent/40"
          >
            <option value="warm">Warm — friendly, not effusive</option>
            <option value="neutral">Neutral — professional and plain</option>
            <option value="brief">Brief — scannable on a phone</option>
          </select>
        </div>
      </div>
    </Card>
  );
}
