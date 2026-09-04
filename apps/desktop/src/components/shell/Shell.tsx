// The persistent app shell (MainDraw-style): a dark nav rail, the current screen
// rendered as an embedded "window" card, and one ever-present chat input pinned
// at the bottom. Only the embedded screen changes on navigation — the rail, the
// thread state and the input never unmount.
import { useCallback, useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { House, CircleDot, Library, Sparkles, SquareCheck, Settings2, MessageSquare, type LucideIcon } from "lucide-react";
import { formatElapsed } from "@ledgeur/ui";
import { Sidebar } from "../Sidebar.tsx";
import { MobileTabBar } from "../MobileTabBar.tsx";
import { CommandPalette } from "../CommandPalette.tsx";
import { GlobalInput } from "./GlobalInput.tsx";
import { ScreenEmbedCard } from "./ScreenEmbedCard.tsx";
import { UpdateBanner } from "./UpdateBanner.tsx";
import { useRecorderCtx } from "../../lib/useRecorderCtx.ts";

/** Screen chrome (window title + icon) derived from the route. */
function screenMeta(pathname: string): { title: string; icon: LucideIcon } {
  if (pathname === "/") return { title: "Home", icon: House };
  if (pathname.startsWith("/record")) return { title: "Record", icon: CircleDot };
  if (pathname.startsWith("/meetings/")) return { title: "Meeting", icon: MessageSquare };
  if (pathname.startsWith("/meetings")) return { title: "Library", icon: Library };
  if (pathname.startsWith("/ask")) return { title: "Copilot", icon: Sparkles };
  if (pathname.startsWith("/tasks")) return { title: "Tasks", icon: SquareCheck };
  if (pathname.startsWith("/integrations")) return { title: "Settings", icon: Settings2 };
  return { title: "Ledgeur", icon: House };
}

export function Shell() {
  const [palette, setPalette] = useState(false);
  const openPalette = useCallback(() => setPalette(true), []);
  const closePalette = useCallback(() => setPalette(false), []);
  const { pathname } = useLocation();
  const { state } = useRecorderCtx();
  const meta = screenMeta(pathname);

  // Global ⌘K / Ctrl+K.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const recordingBadge = state.status === "recording" && (
    <span className="flex items-center gap-1.5 font-mono text-[10px] text-danger">
      <span className="ldg-pulse h-1.5 w-1.5 rounded-full bg-danger" /> {formatElapsed(state.elapsed)}
    </span>
  );

  return (
    <div className="ldg-grain flex h-screen w-screen overflow-hidden bg-paper">
      <Sidebar onOpenPalette={openPalette} />
      <main className="flex min-w-0 flex-1 flex-col">
        {/* Thin draggable strip so the frameless window can be moved. The CSS
            (-webkit-app-region: drag) only works on Chromium-based webviews;
            macOS's WKWebView ignores it entirely and needs the Tauri-specific
            data attribute instead — hence both. */}
        <div className="ldg-drag h-9 shrink-0" data-tauri-drag-region />
        <UpdateBanner />
        <div className="flex min-h-0 flex-1 px-3 pb-2 sm:px-4">
          <ScreenEmbedCard title={meta.title} icon={meta.icon} badge={recordingBadge}>
            <Outlet />
          </ScreenEmbedCard>
        </div>
        <GlobalInput />
      </main>
      <MobileTabBar />
      <CommandPalette open={palette} onClose={closePalette} />
    </div>
  );
}
