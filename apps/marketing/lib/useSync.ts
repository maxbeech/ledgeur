"use client";

// Syncing a meeting to the cloud — the paid tier's first promise.
//
// Deliberately per-meeting and explicit, rather than a background daemon that
// uploads everything. The product's whole claim is that your meetings are yours
// and stay on your machine; silently shipping them off the moment somebody
// signs in would contradict that, and "sync" would become something that
// happened *to* the user rather than something they chose.
//
// So: each meeting is pushed when you say so, and you choose whether it stays
// private to you or joins the workspace library. Row-level security enforces
// the choice — `visibility: 'org'` is the only thing that makes a meeting
// visible to colleagues.

import { useCallback, useEffect, useState } from "react";
import {
  listMeetingSummaries, meetingToMarkdown, toSyncPayload,
  type LocalMeeting, type MeetingSummary,
} from "@ledgeur/core";
import { putMeeting } from "@ledgeur/core/browser";
import { getSupabase } from "./supabase";
import { useSession } from "./useSession";

export type Visibility = "private" | "org";

export interface Workspace {
  id: string;
  name: string;
  plan: "free" | "team" | "company";
}

export interface SyncState {
  workspace: Workspace | null;
  /** Meetings already in the cloud — yours, plus anything shared with you. */
  remote: MeetingSummary[];
  loading: boolean;
  /** True when this workspace is allowed to sync at all. */
  paid: boolean;
  error: string;
}

export function useSync() {
  const { session } = useSession();
  const [state, setState] = useState<SyncState>({
    workspace: null, remote: [], loading: false, paid: false, error: "",
  });
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const sb = getSupabase();
    if (!sb || !session) {
      setState({ workspace: null, remote: [], loading: false, paid: false, error: "" });
      return;
    }
    setState((s) => ({ ...s, loading: true }));
    try {
      // RLS returns only workspaces this user belongs to.
      const { data, error } = await sb.from("orgs").select("id, name, plan").limit(1).maybeSingle();
      if (error) throw new Error(error.message);
      const workspace = (data as Workspace) ?? null;
      const paid = workspace?.plan === "team" || workspace?.plan === "company";
      // Listing costs a round-trip and returns nothing useful on a free plan,
      // where there is nothing synced by definition.
      const remote = paid ? await listMeetingSummaries(sb, 100) : [];
      setState({ workspace, remote, loading: false, paid, error: "" });
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: (e as Error).message }));
    }
  }, [session]);

  useEffect(() => { void refresh(); }, [refresh]);

  /**
   * Push one meeting.
   *
   * Inserts the meeting, its speakers, its transcript, its notes and its action
   * items. The payload comes from `toSyncPayload` in @ledgeur/core, which is
   * the only path to the wire and which drops voice prints — those never leave
   * the device, on any plan.
   */
  const push = useCallback(async (
    meeting: LocalMeeting,
    visibility: Visibility = "private",
  ): Promise<LocalMeeting> => {
    const sb = getSupabase();
    if (!sb || !session) throw new Error("Sign in first.");
    if (!state.workspace) throw new Error("No workspace found for your account.");
    if (!state.paid) {
      throw new Error("Syncing is part of the Team plan. Your meetings stay on this device until then.");
    }

    setBusyId(meeting.id);
    // Set once the meeting row exists, so a failure part-way through can undo
    // it. Supabase has no client-side transaction across tables: without this,
    // a segment insert that fails leaves a meeting in the workspace with a
    // title, no transcript and no notes — which looks to a colleague like a
    // recording that captured nothing.
    let created: string | null = null;
    try {
      const payload = toSyncPayload(meeting, meetingToMarkdown(meeting));

      const { data: row, error: mErr } = await sb
        .from("meetings")
        .insert({ ...payload.meeting, org_id: state.workspace.id, owner_id: session.user.id, visibility })
        .select("id")
        .single();
      if (mErr) throw new Error(mErr.message);
      const meetingId = (row as { id: string }).id;
      created = meetingId;

      // Speakers first: the segments need their generated ids.
      let speakerIds: string[] = [];
      if (payload.speakers.length) {
        const { data: rows, error } = await sb
          .from("speakers")
          .insert(payload.speakers.map((s) => ({ ...s, meeting_id: meetingId })))
          .select("id");
        if (error) throw new Error(error.message);
        speakerIds = ((rows ?? []) as { id: string }[]).map((r) => r.id);
      }

      if (payload.segments.length) {
        const { error } = await sb.from("transcript_segments").insert(
          payload.segments.map((s) => ({
            meeting_id: meetingId,
            speaker_id: s.speakerIndex == null ? null : (speakerIds[s.speakerIndex] ?? null),
            start_ms: s.start_ms, end_ms: s.end_ms, text: s.text, confidence: s.confidence,
          })),
        );
        if (error) throw new Error(error.message);
      }

      const { error: nErr } = await sb
        .from("meeting_notes")
        .insert({ ...payload.note, meeting_id: meetingId });
      if (nErr) throw new Error(nErr.message);

      if (payload.actionItems.length) {
        const { error } = await sb.from("action_items").insert(
          payload.actionItems.map((title) => ({ org_id: state.workspace!.id, meeting_id: meetingId, title })),
        );
        if (error) throw new Error(error.message);
      }

      // Recorded locally so the UI can say "synced" without asking again, and so
      // a second push does not create a duplicate.
      const synced = { ...meeting, remoteId: meetingId, updatedAt: new Date().toISOString() };
      await putMeeting(synced);
      created = null; // committed
      void refresh();
      return synced;
    } catch (e) {
      if (created) {
        // Every child row cascades on delete, so removing the meeting removes
        // the half-written speakers and segments with it. Best effort: if the
        // cleanup itself fails there is nothing further to try, and the original
        // error is the one worth reporting.
        await sb.from("meetings").delete().eq("id", created).then(undefined, () => undefined);
      }
      throw e;
    } finally {
      setBusyId(null);
    }
  }, [session, state.workspace, state.paid, refresh]);

  return { ...state, push, busyId, refresh };
}
