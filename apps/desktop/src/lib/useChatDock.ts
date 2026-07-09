// Split out of chatDock.tsx: a file exporting both a component and a hook
// breaks Vite Fast Refresh (full remount instead of a hot update).

import { useContext } from "react";
import { ChatDockCtx, type ChatDock } from "./chatDock.tsx";

export function useChatDock(): ChatDock {
  const ctx = useContext(ChatDockCtx);
  if (!ctx) throw new Error("useChatDock must be used inside <ChatDockProvider>.");
  return ctx;
}
