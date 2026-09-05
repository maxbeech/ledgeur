// Grounding for the app-wide copilot: the company memory (Contextely), the org
// hive mind, connected tools (Notion, Calendar) and this device's own meetings.
//
// The gathering itself lives in contextSources.ts, shared with the in-meeting
// copilot — there is one definition of "what Ledgeur knows", and the two
// surfaces differ only in what they add on top (a live transcript) and how long
// they are willing to wait.

import { combine, calendarSource, contextelySource, localMeetingsSource, notionSource, semanticSource, type GatheredContext } from "./contextSources.ts";
import type { ContextBlock } from "@ledgeur/core";

/**
 * Everything relevant to a question, with per-source outcomes.
 *
 * No deadline here, unlike the meeting copilot: nobody is mid-sentence, and a
 * complete answer beats a fast one when you are sitting looking at Ask.
 */
export async function gatherContextDetailed(question: string): Promise<GatheredContext> {
  const results = await Promise.all([
    contextelySource(question),
    semanticSource(question),
    notionSource(question),
    calendarSource(),
    localMeetingsSource(question, { limit: 12 }),
  ]);
  return combine(results);
}

/** Just the blocks — for callers that don't surface source health. */
export async function gatherContext(question: string): Promise<ContextBlock[]> {
  return (await gatherContextDetailed(question)).blocks;
}
