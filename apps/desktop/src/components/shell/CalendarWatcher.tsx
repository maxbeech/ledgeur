// Renders nothing; watches the calendar for the whole app's lifetime.
//
// This used to hang off the Home screen's TodaySchedule card, so the "your
// meeting is starting" prompt only existed while you happened to be looking at
// Home — and auto-start, which has to work while the app sits in the background,
// could not have worked there at all. It lives in the Shell instead, which is
// mounted for as long as the app is open.

import { useNavigate } from "react-router-dom";
import type { CalendarEvent } from "@ledgeur/core";
import { useTodayEvents } from "../../lib/useCalendar.ts";
import { useMeetingPrompts } from "../../lib/meetingPrompt.ts";
import { useRecorderCtx } from "../../lib/useRecorderCtx.ts";
import { getSettings } from "../../lib/settings.ts";
import { createLogger } from "../../lib/logger.ts";

const log = createLogger("calendar-watcher");

export function CalendarWatcher() {
  const { events } = useTodayEvents();
  const nav = useNavigate();
  const { state, start, setTitle } = useRecorderCtx();

  const begin = (event: CalendarEvent) => {
    const { transcriptionLang, captureSystemAudio, noteTemplate } = getSettings();
    setTitle(event.title);
    // Straight to the meeting room, so a recording that started by itself is
    // never invisible: the user sees the live transcript, the timer, and Stop.
    nav("/record");
    void start({ mic: true, system: captureSystemAudio, lang: transcriptionLang, template: noteTemplate })
      .catch((e: unknown) => log.error("calendar auto-start failed", e));
  };

  useMeetingPrompts(events, {
    start: begin,
    busy: state.status === "recording" || state.status === "processing",
  });

  return null;
}
