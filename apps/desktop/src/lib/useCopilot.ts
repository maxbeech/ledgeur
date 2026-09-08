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
  /**
   * The model has *just* finished arriving, having previously been missing.
   *
   * Without this, a finished download is indistinguishable from a broken
   * prompt: the banner simply vanishes. "Unclear if the model installed as I
   * can't see the download banner now - maybe it's been done in the background,
   * I don't know" is exactly that gap, reported. Clears itself after a moment;
   * the durable answer lives in Settings, On-device AI.
   */
  justReady: boolean;
  downloading: boolean;
  /** 0–100 while downloading. */
  progress: number;
  modelName: string;
  /** Why the last download attempt failed, if it did. Empty when all is well. */
  error: string;
  startDownload: () => Promise<void>;
}

/** How often readiness is re-checked while the model still isn't available. */
const IDLE_POLL_MS = 4_000;
/** Faster cadence while a download is streaming, so the bar actually moves. */
const DOWNLOAD_POLL_MS = 800;
/** How long the "copilot is ready now" confirmation stays up. */
const JUST_READY_MS = 8_000;

export function useCopilot(): CopilotReadiness {
  const [st, setSt] = useState<LlmStatus | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");
  const [justReady, setJustReady] = useState(false);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);
  // Whether this hook has ever seen the weights missing. Only then is their
  // arrival news — on every later meeting the model is simply there, and
  // announcing it would be noise.
  const sawMissing = useRef(false);

  const refresh = useCallback(() => llmStatus().then(setSt, () => {}), []);

  // Re-check while the model isn't ready yet. Status used to be read exactly
  // once, when the hook mounted, so a download finishing anywhere else — the
  // Settings card, or a previous run of this same screen — left this copy of
  // the state permanently stale: the "Download" prompt stayed up over weights
  // that were already on disk, and pressing it did nothing visible, because the
  // command correctly returns straight away when the file is already there.
  const ready = Boolean(st?.modelReady);
  useEffect(() => {
    refresh();
    if (ready) return;
    const id = setInterval(refresh, downloading ? DOWNLOAD_POLL_MS : IDLE_POLL_MS);
    return () => clearInterval(id);
  }, [refresh, ready, downloading]);

  // Announce the transition, not the state.
  useEffect(() => {
    if (st && !ready) { sawMissing.current = true; return; }
    if (!ready || !sawMissing.current) return;
    sawMissing.current = false;
    setJustReady(true);
    const id = setTimeout(() => setJustReady(false), JUST_READY_MS);
    return () => clearTimeout(id);
  }, [st, ready]);

  useEffect(() => () => { if (poll.current) clearInterval(poll.current); }, []);

  const startDownload = useCallback(async () => {
    setDownloading(true);
    setError("");
    try {
      await downloadLlmModel();
    } catch (e) {
      // Previously this had a `finally` and no `catch`, so a failed download
      // became an unhandled rejection (the caller invokes it as `void
      // startDownload()`) and the prompt just reverted to "Download" with no
      // explanation at all.
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDownloading(false);
      // Deliberately last, and not awaited into the state updates above: if the
      // status call itself fails, `downloading` must still have been cleared.
      void refresh();
    }
  }, [refresh]);

  const compiled = Boolean(st?.compiled);
  return {
    ready,
    // Only offer a download inside the native shell that can actually run it.
    needsDownload: isTauri() && compiled && !ready,
    justReady,
    downloading: downloading || Boolean(st?.downloading),
    progress: st?.progress ?? 0,
    modelName: st?.modelName ?? "on-device model",
    error,
    startDownload,
  };
}
