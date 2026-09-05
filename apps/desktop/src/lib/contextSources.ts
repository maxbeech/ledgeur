// Where grounding comes from, and what happened when it didn't.
//
// Every surface that answers a question — the app-wide Ask, the live meeting
// copilot — needs the same sources: the company memory in Contextely, Notion,
// the org's indexed meetings, the calendar, and this device's own recordings.
// They used to be gathered in one function that swallowed every failure in a
// single `catch {}`, so "Contextely is not connected", "your key expired" and
// "the embeddings endpoint timed out" were all indistinguishable from "nothing
// relevant was found".
//
// This module gathers each source independently and reports per-source outcome.
// A source that fails is named, with its own error, rather than quietly
// vanishing from the answer's evidence.

import type { ContextBlock } from "@ledgeur/core";
import { listMeetings } from "./meetingsStore.ts";
import { rankMeetings, meetingToBlock } from "./meetingRanking.ts";
import { getSupabase } from "./supabase.ts";
import { semanticContext } from "./embeddings.ts";
import { notionContext } from "./notion.ts";
import { contextelyContext } from "./contextely.ts";
import { calendarContext } from "./calendar.ts";
import { createLogger } from "./logger.ts";

const log = createLogger("context");

/** What one source contributed, and why it contributed nothing if it didn't. */
export interface SourceResult {
  /** Stable id — "contextely", "notion", "meetings", … */
  id: string;
  /** Shown to a person: "Contextely company memory". */
  label: string;
  blocks: ContextBlock[];
  /** Present only when the source was reachable-but-failed. Not set for a
   *  source that is simply not connected. */
  error?: string;
  /** True when the source is not set up at all — nothing to report. */
  unconfigured?: boolean;
}

export interface GatheredContext {
  blocks: ContextBlock[];
  results: SourceResult[];
  /** Sources that errored, for an inline "answered without X" note. */
  failed: SourceResult[];
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function collect(id: string, label: string, run: () => Promise<ContextBlock[]>): Promise<SourceResult> {
  try {
    return { id, label, blocks: await run() };
  } catch (e) {
    log.warn(`context source failed: ${id}`, e);
    return { id, label, blocks: [], error: message(e) };
  }
}

/** True when there is a signed-in session — the precondition for every
 *  server-side source. Never throws. */
async function signedIn(): Promise<boolean> {
  try {
    const sb = getSupabase();
    if (!sb) return false;
    const { data } = await sb.auth.getSession();
    return Boolean(data.session);
  } catch {
    return false;
  }
}

/**
 * Contextely — the company memory shared with Beech's other product.
 *
 * Called out separately from the rest because it is the one source whose
 * absence a person is likely to notice and ask about ("why doesn't it know
 * our pricing?"). `contextelyContext` deliberately never throws, so the only
 * way to distinguish "not connected" from "connected but empty" is to ask.
 */
export async function contextelySource(question: string): Promise<SourceResult> {
  const label = "Contextely company memory";
  if (!(await signedIn())) {
    return { id: "contextely", label, blocks: [], unconfigured: true };
  }
  const result = await collect("contextely", label, () => contextelyContext(question));
  if (!result.error && result.blocks.length === 0) {
    // No blocks with a live session: either not connected, or genuinely nothing
    // matched. The integrations table answers that without another round trip
    // to Contextely itself.
    try {
      const sb = getSupabase();
      const { data } = (await sb!.from("integrations").select("id").eq("provider", "contextely").maybeSingle()) ?? {};
      if (!data) return { ...result, unconfigured: true };
    } catch {
      /* the check is a nicety; a failed check just means no extra explanation */
    }
  }
  return result;
}

/** The org's indexed meetings, by semantic search. Requires a session and a
 *  working embeddings endpoint — both are reported, not assumed. */
export async function semanticSource(question: string): Promise<SourceResult> {
  const label = "Org knowledge base";
  if (!(await signedIn())) return { id: "semantic", label, blocks: [], unconfigured: true };
  return collect("semantic", label, async () => {
    const sb = getSupabase();
    const { data: org } = await sb!.from("orgs").select("id").limit(1).maybeSingle();
    if (!org) return [];
    return semanticContext(org.id, question);
  });
}

export async function notionSource(question: string): Promise<SourceResult> {
  const label = "Notion";
  if (!(await signedIn())) return { id: "notion", label, blocks: [], unconfigured: true };
  return collect("notion", label, () => notionContext(question));
}

export async function calendarSource(): Promise<SourceResult> {
  return collect("calendar", "Calendar", () => calendarContext());
}

/**
 * This device's own recordings, ranked against the question.
 *
 * Previously the newest twelve, regardless of the question — so anything asked
 * about a meeting from three weeks ago was answered with "I don't have that
 * information", while the answer sat in IndexedDB. Recency still breaks ties,
 * because two equally relevant meetings should surface the newer one.
 */
export async function localMeetingsSource(
  question: string,
  options: { limit?: number; excludeId?: string } = {},
): Promise<SourceResult> {
  const { limit = 8, excludeId } = options;
  return collect("meetings", "Your meetings", async () => {
    const all = (await listMeetings()).filter((m) => m.id !== excludeId);
    return rankMeetings(all, question, limit).map(meetingToBlock);
  });
}

/** Fold a set of source results into one context list plus the failures. */
export function combine(results: SourceResult[]): GatheredContext {
  return {
    blocks: results.flatMap((r) => r.blocks),
    results,
    failed: results.filter((r) => r.error),
  };
}
