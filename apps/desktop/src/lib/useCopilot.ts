// Copilot readiness: is an on-device model ready to answer, and if not, can we
// download it in one tap? Drives the inline "Get the copilot ready" prompt so
// the user never has to install or launch anything (task #1).

import { useCallback, useEffect, useRef, useState } from "react";
import { isTauri } from "./runtime.ts";
import { llmStatus, downloadLlmModel, type LlmStatus } from "./llm.ts";

export interface CopilotReadiness {
  /** The native model weights are on disk and ready. */
  ready: boolean;
  /** A native build is present but the weights need a one-time download. */
  needsDownload: boolean;
  downloading: boolean;
  /** 0–100 while downloading. */
  progress: number;
  modelName: string;
  startDownload: () => Promise<void>;
}

export function useCopilot(): CopilotReadiness {
  const [st, setSt] = useState<LlmStatus | null>(null);
  const [downloading, setDownloading] = useState(false);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(() => llmStatus().then(setSt), []);
  useEffect(() => {
    refresh();
    return () => { if (poll.current) clearInterval(poll.current); };
  }, [refresh]);

  const startDownload = useCallback(async () => {
    setDownloading(true);
    poll.current = setInterval(refresh, 800);
    try {
      await downloadLlmModel();
    } finally {
      if (poll.current) { clearInterval(poll.current); poll.current = null; }
      await refresh();
      setDownloading(false);
    }
  }, [refresh]);

  const compiled = Boolean(st?.compiled);
  const modelReady = Boolean(st?.modelReady);
  return {
    ready: modelReady,
    // Only offer a download inside the native shell that can actually run it.
    needsDownload: isTauri() && compiled && !modelReady,
    downloading: downloading || Boolean(st?.downloading),
    progress: st?.progress ?? 0,
    modelName: st?.modelName ?? "on-device model",
    startDownload,
  };
}
