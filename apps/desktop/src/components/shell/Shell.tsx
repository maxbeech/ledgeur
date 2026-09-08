// The persistent app shell: a light sidebar on a desktop, bottom tabs on a
// phone, the current screen as a plain scrolling page, and one composer pinned
// at the bottom. Only the screen changes on navigation — the sidebar, the
// thread state and the composer never unmount, which is what lets a recording
// survive a wander through the library.
import { useCallback, useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Sidebar } from "../Sidebar.tsx";
import { MobileTabBar } from "../MobileTabBar.tsx";
import { CommandPalette } from "../CommandPalette.tsx";
import { QuickCapture } from "../capture/QuickCapture.tsx";
import { CaptureToast } from "../capture/CaptureToast.tsx";
import { GlobalInput } from "./GlobalInput.tsx";
import { UpdateBanner } from "./UpdateBanner.tsx";
import { CalendarWatcher } from "./CalendarWatcher.tsx";
import { useDevice } from "../../lib/platform.ts";
import { startSync } from "../../lib/sync.ts";
import { openCapture } from "../../lib/captureDock.ts";
import { startCaptureLinks } from "../../lib/captureLinks.ts";

export function Shell() {
  const [palette, setPalette] = useState(false);
  const openPalette = useCallback(() => setPalette(true), []);
  const closePalette = useCallback(() => setPalette(false), []);
  const { pathname } = useLocation();
  const device = useDevice();

  // The sync engine runs for as long as the app is open.
  useEffect(() => startSync(), []);

  // A widget tap or a deep link opens the capture box, whatever screen the app
  // happens to be on. Runs for the life of the app for the same reason sync
  // does: the link can arrive before any screen has mounted.
  useEffect(() => startCaptureLinks(), []);

  // Global ⌘K / Ctrl+K, and ⌘⇧K / Ctrl+Shift+K for the capture box.
  //
  // The capture shortcut is checked first and deliberately shares a letter: it
  // is the same gesture with one more finger, which is the only kind of
  // shortcut people remember for something they use in a hurry.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "k") return;
      e.preventDefault();
      if (e.shiftKey) openCapture("type");
      else setPalette((p) => !p);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // The live room is a full-height layout of its own; everything else is a
  // page that scrolls. Keyed on the path so a new screen starts at the top.
  const scrollKey = pathname;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-paper">
      {/* Renders nothing — watches the calendar for as long as the app is
          open, so the record prompt and auto-start do not depend on which
          screen happens to be showing. */}
      <CalendarWatcher />
      {!device.phone && <Sidebar onOpenPalette={openPalette} />}
      <main className="flex min-w-0 flex-1 flex-col bg-surface">
        {/* macOS: a thin draggable strip so the frameless window can be moved.
            The CSS (-webkit-app-region) only works on Chromium webviews; WKWebView
            needs the Tauri attribute — hence both. On a phone this is the status
            bar's safe area instead. */}
        {device.phone
          ? <div className="ldg-safe-top shrink-0" />
          : <div className="ldg-drag h-9 shrink-0" data-tauri-drag-region />}
        <UpdateBanner />
        <div key={scrollKey} className="min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </div>
        <GlobalInput />
        {device.phone && <MobileTabBar />}
      </main>
      <CommandPalette open={palette} onClose={closePalette} />
      <QuickCapture />
      <CaptureToast />
    </div>
  );
}
