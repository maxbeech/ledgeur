// Grounding context for the app-level copilot: the org hive mind (semantic
// search when signed in + model up), connected integrations (Notion, Calendar)
// and the user's real local meetings. Shared by the global copilot dock and
// any focused Ask view — single source of truth.

import type { ContextBlock } from "./chat.ts";
import { listMeetings } from "./meetingsStore.ts";
import { getSupabase } from "./supabase.ts";
import { semanticContext } from "./embeddings.ts";
import { notionContext } from "./notion.ts";
import { calendarContext } from "./calendar.ts";

export async function gatherContext(question: string): Promise<ContextBlock[]> {
  let semantic: ContextBlock[] = [];
  let notion: ContextBlock[] = [];
  try {
    const sb = getSupabase();
    if (sb) {
      const { data: { session } } = await sb.auth.getSession();
      if (session) {
        const { data: org } = await sb.from("orgs").select("id").limit(1).maybeSingle();
        if (org) semantic = await semanticContext(org.id, question);
        notion = await notionContext(question);
      }
    }
  } catch {
    /* embedding endpoint / backend unavailable — local context still works */
  }

  const calendar = await calendarContext();

  const meetings = await listMeetings();
  const local = meetings.slice(0, 12).map((m) => ({
    source: `Meeting: ${m.title} (${new Date(m.createdAt).toLocaleDateString()})`,
    text: [m.summary.join(" "), m.actionItems.length ? `Action items: ${m.actionItems.join("; ")}` : ""].filter(Boolean).join("\n"),
  }));
  return [...semantic, ...notion, ...calendar, ...local];
}
