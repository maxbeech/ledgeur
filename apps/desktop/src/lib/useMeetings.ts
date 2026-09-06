// The meetings list for the UI, from the local cache.
//
// The cache holds everything: meetings recorded here, and every meeting the
// account can see, pulled by the sync engine (sync.ts). So the list, search,
// the sidebar and the copilot all read one store, and all of it works offline.
// The list refreshes itself whenever the store changes — a new recording, a
// rename, a pull from another device.

import { useCallback, useEffect, useState } from "react";
import { listMeetings as listLocal, subscribeMeetings } from "./meetingsStore.ts";

export interface MeetingCard {
  id: string;
  title: string;
  createdAt: string;
  wordCount: number;
  actionItemCount: number;
  /** "cloud" once the account has it; "local" while it is only on this device. */
  source: "local" | "cloud";
  /** Lowercased searchable text: title plus everything that was said. */
  haystack: string;
  /** The space this meeting is filed in, when it has one. */
  folderId?: string;
}

export function useMeetings() {
  const [cards, setCards] = useState<MeetingCard[] | null>(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const local = await listLocal();
      setCards(local.map((m) => ({
        id: m.id, title: m.title, createdAt: m.createdAt,
        wordCount: m.wordCount, actionItemCount: m.actionItems.length,
        source: m.synced ? "cloud" : "local",
        haystack: `${m.title} ${m.segments.map((s) => s.text).join(" ")}`.toLowerCase(),
        folderId: m.folderId,
      })));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
    return subscribeMeetings(() => { void refresh(); });
  }, [refresh]);

  return { cards, error, refresh };
}
