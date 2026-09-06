"use client";

// The web app.
//
// Local-first by design: everything on this screen works with no account, no
// network after the first model download, and no data leaving the device. The
// account is an addition — sync and agent access — never a gate.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { LocalMeeting } from "@ledgeur/core";
import { Button, Card, ErrorNote, Label, ProgressBar } from "@ledgeur/ui/components";
import { useLibrary } from "@/lib/useLibrary";
import { useWebRecorder } from "@/lib/useWebRecorder";
import { useImport, IMPORT_ACCEPT } from "@/lib/useImport";
import { useSession } from "@/lib/useSession";
import { SITE } from "@/lib/site";
import { DropZone } from "./DropZone";
import { RecordPanel } from "./RecordPanel";
import { MeetingView } from "./MeetingView";
import { Library } from "./Library";
import { SyncCard } from "./SyncCard";

export default function AppShell() {
  const library = useLibrary();
  const { session, available } = useSession();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const openSaved = useCallback((meeting: LocalMeeting) => {
    void library.refresh().then(() => setSelectedId(meeting.id));
  }, [library]);

  const recorder = useWebRecorder(openSaved);
  const importer = useImport(openSaved);

  const selected = library.meetings.find((m) => m.id === selectedId) ?? null;

  // Warn before closing mid-recording. A meeting lost to a stray ⌘W is the
  // single most expensive thing this app could do to somebody.
  useEffect(() => {
    if (recorder.state.phase !== "recording" && recorder.state.phase !== "finishing") return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [recorder.state.phase]);

  const handleFile = useCallback((file: File) => {
    if (recorder.state.phase === "recording") return; // never interrupt a live meeting
    setSelectedId(null);
    void importer.importFile(file);
  }, [importer, recorder.state.phase]);

  const renameSpeaker = useCallback(async (speaker: number, name: string): Promise<string> => {
    if (!selected) return "";
    const embedding = selected.speakers.find((s) => s.speaker === speaker)?.embedding;
    const { rememberError } = await library.nameSpeaker(selected, speaker, name, embedding);
    return rememberError;
  }, [selected, library]);

  const busy = recorder.state.phase === "recording" || recorder.state.phase === "finishing" || importer.state.busy;

  return (
    <DropZone onFile={handleFile} disabled={recorder.state.phase === "recording"}>
      <input
        ref={fileInput}
        type="file"
        accept={IMPORT_ACCEPT}
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          // Reset first, so choosing the same file twice fires again.
          e.target.value = "";
          if (file) handleFile(file);
        }}
      />

      <div className="mx-auto grid max-w-6xl gap-6 px-5 py-6 lg:grid-cols-[300px_1fr]">
        {/* ------------------------------------------------------ sidebar */}
        <aside className={`lg:sticky lg:top-[80px] lg:h-[calc(100dvh-9rem)] ${selected ? "hidden lg:block" : ""}`}>
          <Card className="h-full overflow-hidden">
            <Library
              meetings={library.meetings}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onNew={() => { setSelectedId(null); recorder.reset(); }}
              loading={library.loading}
              error={library.error}
            />
          </Card>

          <div className="mt-4 rounded-xl bg-paper p-4">
            {available && session ? (
              <>
                <Label>Signed in</Label>
                <p className="mt-1.5 text-sm text-muted">{session.user.email}</p>
                <Link href="/account" className="mt-2 inline-block text-sm font-medium text-brand-strong hover:underline">
                  Plan, billing and agent access
                </Link>
              </>
            ) : (
              <>
                <Label>Only on this device</Label>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">
                  Your meetings are here and nowhere else. Sign in to sync them across
                  your devices and open them to your AI agents.
                </p>
                {available && (
                  <Link href="/signin?next=/app" className="mt-2.5 inline-block text-sm font-medium text-brand-strong hover:underline">
                    Sign in
                  </Link>
                )}
              </>
            )}
          </div>
        </aside>

        {/* --------------------------------------------------------- main */}
        <div className={selected ? "" : "min-w-0"}>
          {importer.state.busy && (
            <Card raised className="mb-5 p-5">
              <div className="flex items-center gap-3">
                <span className="ldg-pulse inline-block h-2 w-2 rounded-full bg-brand" aria-hidden />
                <div className="min-w-0">
                  <p className="truncate text-base font-medium text-ink-text">{importer.state.name}</p>
                  <p className="text-sm text-muted">{importer.state.step}</p>
                </div>
              </div>
              {importer.state.modelProgress > 0 && importer.state.modelProgress < 100 && (
                <ProgressBar value={importer.state.modelProgress} className="mt-3" />
              )}
              <p className="mt-3 text-xs text-faint">Transcribed on this device. The file is not uploaded anywhere.</p>
            </Card>
          )}

          {importer.state.error && (
            <ErrorNote className="mb-5" onRetry={<Button size="sm" tone="secondary" onClick={importer.dismiss}>Dismiss</Button>}>
              {importer.state.error}
            </ErrorNote>
          )}

          {selected ? (
            <div className="space-y-5">
              <MeetingView
                meeting={selected}
                onRename={renameSpeaker}
                onMerge={(from, into) => { if (selected) void library.mergeSpeakers(selected, from, into); }}
                onSave={(m) => void library.save(m)}
                onDelete={() => { void library.remove(selected.id); setSelectedId(null); }}
                onBack={() => setSelectedId(null)}
              />
              <SyncCard meeting={selected} onSynced={(m) => void library.save(m)} />
            </div>
          ) : (
            <RecordPanel
              state={recorder.state}
              onStart={(opts) => void recorder.start(opts)}
              onStop={() => void recorder.stop()}
              onReset={recorder.reset}
              onPickFile={() => fileInput.current?.click()}
              onSample={(lang) => void importer.importSample(SITE.sampleAudioUrl, lang)}
            />
          )}

          {!busy && !selected && library.meetings.length === 0 && (
            <Card className="mt-5 border-dashed border-hairline-strong p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-base font-semibold text-ink-text">Nothing to record right now?</div>
                  <p className="mt-1 text-sm leading-relaxed text-muted">
                    Drag in any recording you already have — a voice memo, a Zoom export, an old
                    interview. It is treated exactly like a live meeting.
                  </p>
                </div>
                <Button tone="secondary" size="sm" onClick={() => fileInput.current?.click()}>Choose a file</Button>
              </div>
            </Card>
          )}
        </div>
      </div>
    </DropZone>
  );
}
