import { useCallback, useEffect, useRef, useState } from "react";
import { HashRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { Sidebar } from "./components/Sidebar.tsx";
import { MobileTabBar } from "./components/MobileTabBar.tsx";
import { CommandPalette } from "./components/CommandPalette.tsx";
import { RecorderProvider } from "./lib/recorderContext.tsx";
import { Home } from "./screens/Home.tsx";
import { Record } from "./screens/Record.tsx";
import { Meetings } from "./screens/Meetings.tsx";
import { MeetingDetail } from "./screens/MeetingDetail.tsx";
import { Ask } from "./screens/Ask.tsx";
import { Tasks } from "./screens/Tasks.tsx";
import { Integrations } from "./screens/Integrations.tsx";

/** The scrollable content pane, reset to the top on every route change. */
function ContentPane({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();
  useEffect(() => { ref.current?.scrollTo({ top: 0 }); }, [pathname]);
  return <div ref={ref} className="min-h-0 flex-1 overflow-y-auto">{children}</div>;
}

export function App() {
  const [palette, setPalette] = useState(false);
  const openPalette = useCallback(() => setPalette(true), []);
  const closePalette = useCallback(() => setPalette(false), []);

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

  return (
    <HashRouter>
      <RecorderProvider>
        <div className="pn-grain flex h-screen w-screen overflow-hidden bg-paper">
          <Sidebar onOpenPalette={openPalette} />
          <main className="flex min-w-0 flex-1 flex-col">
            {/* Thin draggable strip so the frameless window can be moved. */}
            <div className="pn-drag h-9 shrink-0" />
            <ContentPane>
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/record" element={<Record />} />
                <Route path="/meetings" element={<Meetings />} />
                <Route path="/meetings/:id" element={<MeetingDetail />} />
                <Route path="/ask" element={<Ask />} />
                <Route path="/tasks" element={<Tasks />} />
                <Route path="/integrations" element={<Integrations />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </ContentPane>
          </main>
          <MobileTabBar />
          <CommandPalette open={palette} onClose={closePalette} />
        </div>
      </RecorderProvider>
    </HashRouter>
  );
}
