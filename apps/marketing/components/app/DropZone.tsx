"use client";

// Drag a recording anywhere onto the app.
//
// Whole-window rather than a bordered box in one corner: people drag a file at
// the app, not at a rectangle, and a drop target you have to aim for is a drop
// target people miss. The overlay only appears once a drag carrying files
// enters the window, so it never sits in the way.

import { useCallback, useEffect, useState, type ReactNode } from "react";

export function DropZone({
  onFile, disabled, children,
}: { onFile: (file: File) => void; disabled?: boolean; children: ReactNode }) {
  const [over, setOver] = useState(false);

  // Counted rather than a boolean: dragging across a child element fires
  // dragleave on the parent, and a naive boolean flickers the overlay off and
  // on the whole way across the page.
  const [depth, setDepth] = useState(0);
  useEffect(() => { setOver(depth > 0); }, [depth]);

  const carriesFiles = (e: DragEvent) =>
    Array.from(e.dataTransfer?.types ?? []).includes("Files");

  useEffect(() => {
    if (disabled) return;
    const onEnter = (e: DragEvent) => { if (carriesFiles(e)) { e.preventDefault(); setDepth((d) => d + 1); } };
    const onOver = (e: DragEvent) => { if (carriesFiles(e)) e.preventDefault(); };
    const onLeave = (e: DragEvent) => { if (carriesFiles(e)) setDepth((d) => Math.max(0, d - 1)); };
    const onDrop = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      e.preventDefault();
      setDepth(0);
      const file = e.dataTransfer?.files?.[0];
      if (file) onFile(file);
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [onFile, disabled]);

  return (
    <>
      {children}
      {over && !disabled && (
        <div
          className="ldg-fade-in fixed inset-0 z-50 grid place-items-center bg-ink/70 p-6 backdrop-blur-sm"
          aria-hidden
        >
          <div className="rounded-2xl border-2 border-dashed border-paper/60 px-10 py-12 text-center">
            <p className="ldg-display text-[26px] text-on-ink">Drop it anywhere</p>
            <p className="mt-2 text-[14px] text-on-ink-muted">
              Audio or video. It is transcribed on this device, exactly like a live meeting.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
