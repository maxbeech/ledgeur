// Unified meetings list for the UI. Cloud is the source of truth: when signed in
// we show workspace meetings (from any device) plus any local meetings not yet
// synced; offline/local-only we show the local cache. Cloud failures fall back to
// local silently so the app always works.

import { useCallback, useEffect, useState } from "react";
import { listMeetingSummaries } from "@parleynotes/core";
import { listMeetings as listLocal } from "./meetingsStore.ts";
import { getSupabase } from "./supabase.ts";

export interface MeetingCard {
  id: string;
  title: string;
  createdAt: string;
  wordCount: number;
  actionItemCount: number;
  source: "local" | "cloud";
  /** Lowercased searchable text (title + transcript for local, title for cloud). */
  haystack: string;
}

export function useMeetings() {
  const [cards, setCards] = useState<MeetingCard[] | null>(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const local = await listLocal();

      let cloud: MeetingCard[] = [];
      const sb = getSupabase();
      if (sb) {
        const { data: { session } } = await sb.auth.getSession();
        if (session) {
          try {
            const summaries = await listMeetingSummaries(sb);
            cloud = summaries.map((s) => ({
              id: s.meeting.id, title: s.meeting.title, createdAt: s.meeting.createdAt,
              wordCount: s.wordCount, actionItemCount: s.actionItemCount, source: "cloud",
              haystack: s.meeting.title.toLowerCase(),
            }));
          } catch { /* cloud unavailable — keep local */ }
        }
      }

      // Once cloud has a meeting, its synced local twin is redundant; show only
      // local meetings that haven't been synced.
      const localCards: MeetingCard[] = local
        .filter((m) => cloud.length === 0 || !m.synced)
        .map((m) => ({
          id: m.id, title: m.title, createdAt: m.createdAt,
          wordCount: m.wordCount, actionItemCount: m.actionItems.length, source: "local",
          haystack: `${m.title} ${m.segments.map((s) => s.text).join(" ")}`.toLowerCase(),
        }));

      const merged = [...cloud, ...localCards].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      setCards(merged);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return { cards, error, refresh };
}
