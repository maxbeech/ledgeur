"use client";

// Sending one meeting to the cloud.
//
// Explicit and per-meeting, with the sharing choice made at the moment of
// sending. Anything else would mean "sync" happened *to* the user rather than
// being something they chose, which would contradict the entire pitch.

import { useState } from "react";
import Link from "next/link";
import type { LocalMeeting } from "@ledgeur/core";
import { Badge, Button, Card, ErrorNote, Kicker } from "@ledgeur/ui/components";
import { useSync, type Visibility } from "@/lib/useSync";
import { useSession } from "@/lib/useSession";

export function SyncCard({
  meeting, onSynced,
}: { meeting: LocalMeeting; onSynced: (m: LocalMeeting) => void }) {
  const { session, available } = useSession();
  const sync = useSync();
  const [visibility, setVisibility] = useState<Visibility>("private");
  const [error, setError] = useState("");

  if (!available) return null;

  const synced = Boolean(meeting.remoteId);
  const busy = sync.busyId === meeting.id;

  async function push() {
    setError("");
    try {
      onSynced(await sync.push(meeting, visibility));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Card raised className="p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Kicker>Sync</Kicker>
        {synced && <Badge tone="accent">In the cloud</Badge>}
      </div>

      {!session ? (
        <>
          <p className="mt-2.5 text-[13.5px] leading-relaxed text-muted">
            This meeting is on this device only. Sign in on the Team plan to reach it from your
            other devices, share it with your workspace, and let your AI agents read it.
          </p>
          <Link href="/signin?next=/app" className="mt-3 inline-block text-[13.5px] font-medium text-accent-strong hover:underline">
            Sign in →
          </Link>
        </>
      ) : !sync.paid ? (
        <>
          <p className="mt-2.5 text-[13.5px] leading-relaxed text-muted">
            Your workspace is on the free plan, so this meeting stays here — which is the default
            and is not a problem. Syncing, the shared library and agent access come with the Team
            plan.
          </p>
          <Link href="/account" className="mt-3 inline-block text-[13.5px] font-medium text-accent-strong hover:underline">
            See the Team plan →
          </Link>
        </>
      ) : synced ? (
        <p className="mt-2.5 text-[13.5px] leading-relaxed text-muted">
          Sent to {sync.workspace?.name ?? "your workspace"}. The copy on this device is still the
          one you are reading — nothing was moved or deleted.
        </p>
      ) : (
        <>
          <p className="mt-2.5 text-[13.5px] leading-relaxed text-muted">
            Send this meeting to {sync.workspace?.name ?? "your workspace"}. The transcript, the
            notes and the speakers go; the voice prints do not, on any plan.
          </p>

          <fieldset className="mt-4">
            <legend className="sr-only">Who can see this meeting</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {([
                ["private", "Only me", "Reachable from your other devices and your agents. Nobody else in the workspace sees it."],
                ["org", "Share with my workspace", "Everyone in the workspace can find and read it."],
              ] as const).map(([value, label, hint]) => (
                <label
                  key={value}
                  className={`cursor-pointer rounded-xl border p-3 transition-colors ${
                    visibility === value ? "border-accent bg-accent-soft" : "border-hairline hover:border-hairline-strong"
                  }`}
                >
                  <input
                    type="radio" name={`visibility-${meeting.id}`} value={value}
                    checked={visibility === value} onChange={() => setVisibility(value)}
                    className="sr-only"
                  />
                  <span className="block text-[13.5px] font-medium text-ink-text">{label}</span>
                  <span className="mt-0.5 block text-[12px] leading-snug text-muted">{hint}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <Button onClick={push} disabled={busy} className="mt-4">
            {busy ? "Sending…" : "Sync this meeting"}
          </Button>
        </>
      )}

      {error && <ErrorNote className="mt-4">{error}</ErrorNote>}
      {sync.error && !error && <ErrorNote className="mt-4">{sync.error}</ErrorNote>}
    </Card>
  );
}
