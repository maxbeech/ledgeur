import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { Sidebar } from "./components/Sidebar.tsx";
import { Brain } from "./screens/Brain.tsx";
import { Record } from "./screens/Record.tsx";
import { Meetings } from "./screens/Meetings.tsx";
import { MeetingDetail } from "./screens/MeetingDetail.tsx";
import { Ask } from "./screens/Ask.tsx";
import { Tasks } from "./screens/Tasks.tsx";
import { Integrations } from "./screens/Integrations.tsx";

export function App() {
  return (
    <HashRouter>
      <div className="flex h-screen w-screen overflow-hidden bg-paper">
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col">
          {/* Thin draggable strip so the frameless window can be moved. */}
          <div className="pn-drag h-9 shrink-0" />
          <div className="min-h-0 flex-1 overflow-y-auto">
            <Routes>
              <Route path="/" element={<Brain />} />
              <Route path="/record" element={<Record />} />
              <Route path="/meetings" element={<Meetings />} />
              <Route path="/meetings/:id" element={<MeetingDetail />} />
              <Route path="/ask" element={<Ask />} />
              <Route path="/tasks" element={<Tasks />} />
              <Route path="/integrations" element={<Integrations />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </div>
        </main>
      </div>
    </HashRouter>
  );
}
