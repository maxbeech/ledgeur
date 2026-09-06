import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App.tsx";
import { AppErrorBoundary } from "./components/shell/AppErrorBoundary.tsx";
import { initSentry } from "./lib/sentry.ts";
import { createLogger } from "./lib/logger.ts";
import { watchTheme } from "./lib/theme.ts";
import "./theme.css";

initSentry();
// Light / dark / system, applied before the first paint so nothing flashes.
watchTheme();

const log = createLogger("window");
window.addEventListener("error", (e) => log.error("uncaught error", e.error ?? e.message));
window.addEventListener("unhandledrejection", (e) => log.error("unhandled promise rejection", e.reason));

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>,
);
