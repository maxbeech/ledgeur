"use client";

// The meeting library as a hook.
//
// Local-first: this reads IndexedDB, which is the primary copy. Signing in adds
// sync on top; it does not change where a meeting lives. That is why every
// function here works identically signed out.

import { useCallback, useEffect, useState } from "react";
import {
  renameSpeaker as renameSpeakerIn, mergeSpeakers as mergeSpeakersIn,
  searchLibrary, type LocalMeeting, type SearchHit,
} from "@ledgeur/core";
import type { VoiceProfile } from "@ledgeur/core";
import {
  listMeetings, putMeeting, deleteMeeting as deleteFromStore, saveVoiceProfile,
} from "@ledgeur/core/browser";

export interface LibraryState {
  meetings: LocalMeeting[];
  loading: boolean;
  /** Set when the browser refuses local storage — private mode, or storage off. */
  error: string;
}

export function useLibrary() {
  const [state, setState] = useState<LibraryState>({ meetings: [], loading: true, error: "" });

  const refresh = useCallback(async () => {
    try {
      setState({ meetings: await listMeetings(), loading: false, error: "" });
    } catch (e) {
      // `loading: false` matters as much as the message: the previous version
      // could leave the sidebar on "Opening your library…" forever, because
      // IndexedDB's `blocked` event fires instead of success *or* error and the
      // promise never settled.
      setState({ meetings: [], loading: false, error: (e as Error).message });
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  /** Insert or replace a meeting, keeping the in-memory list in step. */
  const save = useCallback(async (meeting: LocalMeeting) => {
    await putMeeting(meeting);
    setState((s) => {
      const without = s.meetings.filter((m) => m.id !== meeting.id);
      return { ...s, meetings: [meeting, ...without].sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1)) };
    });
  }, []);

  const remove = useCallback(async (id: string) => {
    await deleteFromStore(id);
    setState((s) => ({ ...s, meetings: s.meetings.filter((m) => m.id !== id) }));
  }, []);

  /**
   * Name a speaker — and remember the voice.
   *
   * This is the moment the product earns its keep, so it does two things at
   * once: it renames the speaker in this meeting, and it saves (or updates) the
   * voice print under that name so the next meeting recognises them.
   *
   * If the voice store refuses to write, the rename still lands. Losing the
   * memory is a smaller failure than losing the edit the user just made.
   */
  const nameSpeaker = useCallback(async (
    meeting: LocalMeeting,
    speaker: number,
    name: string,
    embedding?: readonly number[],
  ): Promise<{ meeting: LocalMeeting; profiles: VoiceProfile[] | null; rememberError: string }> => {
    let profiles: VoiceProfile[] | null = null;
    let rememberError = "";
    let profileId: string | null = meeting.speakers.find((s) => s.speaker === speaker)?.profileId ?? null;

    if (embedding && embedding.length > 0) {
      try {
        profiles = await saveVoiceProfile({ name, embedding, profileId });
        profileId = profiles.find((p) => p.name.toLowerCase() === name.trim().toLowerCase())?.id ?? profileId;
      } catch (e) {
        rememberError = `The name was applied, but this browser would not store the voice print, so ${name} will not be recognised automatically next time. (${(e as Error).message})`;
      }
    }

    const updated = renameSpeakerIn(meeting, speaker, name, profileId);
    await save(updated);
    return { meeting: updated, profiles, rememberError };
  }, [save]);

  /** Fold one speaker into another — the fix when a person was split in two. */
  const mergeSpeakers = useCallback(async (meeting: LocalMeeting, from: number, into: number) => {
    const updated = mergeSpeakersIn(meeting, from, into);
    await save(updated);
    return updated;
  }, [save]);

  const search = useCallback(
    (query: string): SearchHit[] => searchLibrary(state.meetings, query),
    [state.meetings],
  );

  return { ...state, refresh, save, remove, nameSpeaker, mergeSpeakers, search };
}
