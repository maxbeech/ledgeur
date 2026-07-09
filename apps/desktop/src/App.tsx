import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { Shell } from "./components/shell/Shell.tsx";
import { RecorderProvider } from "./lib/recorderContext.tsx";
import { ChatDockProvider } from "./lib/chatDock.tsx";
import { Home } from "./screens/Home.tsx";
import { Record } from "./screens/Record.tsx";
import { Meetings } from "./screens/Meetings.tsx";
import { MeetingDetail } from "./screens/MeetingDetail.tsx";
import { Ask } from "./screens/Ask.tsx";
import { Tasks } from "./screens/Tasks.tsx";
import { Integrations } from "./screens/Integrations.tsx";

export function App() {
  return (
    <HashRouter>
      <RecorderProvider>
        {/* The chat dock (global copilot + meeting routing) needs the router and
            the recorder, so it sits inside both. The Shell renders the persistent
            layout with the ever-present input; each screen is an embedded card. */}
        <ChatDockProvider>
          <Routes>
            <Route element={<Shell />}>
              <Route path="/" element={<Home />} />
              <Route path="/record" element={<Record />} />
              <Route path="/meetings" element={<Meetings />} />
              <Route path="/meetings/:id" element={<MeetingDetail />} />
              <Route path="/ask" element={<Ask />} />
              <Route path="/tasks" element={<Tasks />} />
              <Route path="/integrations" element={<Integrations />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </ChatDockProvider>
      </RecorderProvider>
    </HashRouter>
  );
}
