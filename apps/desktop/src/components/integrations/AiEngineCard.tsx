import { useEffect, useRef, useState } from "react";
import { Cpu, Check, Download, AlertCircle, MessageSquare } from "lucide-react";
import { Button, Card, Chip, Spinner } from "../ui.tsx";
import { isTauri } from "../../lib/runtime.ts";
import { aiStatus, downloadModels, type NativeAiStatus } from "../../lib/nativeAI.ts";
import { llmStatus, downloadLlmModel, type LlmStatus } from "../../lib/llm.ts";

/** On-device AI engine status + model download. Real state from the Rust core;
 *  in the browser preview it explains that native AI ships in the desktop app. */
export function AiEngineCard() {
  const [status, setStatus] = useState<NativeAiStatus | null | "loading">("loading");
  const [llm, setLlm] = useState<LlmStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [llmBusy, setLlmBusy] = useState(false);
  const [err, setErr] = useState("");
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = () => aiStatus().then((s) => setStatus(s));
  const refreshLlm = () => llmStatus().then(setLlm);
  useEffect(() => {
    refresh();
    refreshLlm();
    return () => { if (poll.current) clearInterval(poll.current); };
  }, []);

  async function download() {
    setBusy(true); setErr("");
    try { await downloadModels(); await refresh(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function downloadLlm() {
    setLlmBusy(true); setErr("");
    // Poll status so the progress bar advances while the download streams.
    poll.current = setInterval(refreshLlm, 800);
    try { await downloadLlmModel(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally {
      if (poll.current) { clearInterval(poll.current); poll.current = null; }
      await refreshLlm();
      setLlmBusy(false);
    }
  }

  const row = (label: string, ok: boolean) => (
    <div className="flex items-center gap-2 text-xs">
      <span className={ok ? "text-accent-strong" : "text-muted"}>{ok ? <Check className="h-3.5 w-3.5" /> : "•"}</span>
      <span className={ok ? "text-ink-text" : "text-muted"}>{label}</span>
    </div>
  );

  return (
    <Card className="p-5">
      <div className="flex items-start gap-3">
        <Cpu className="mt-0.5 h-5 w-5 text-accent-strong" />
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-ink-text">On-device AI engine</span>
            {status && status !== "loading" && (status.compiled
              ? <Chip tone="accent">Native</Chip>
              : <Chip>Webview (transformers.js)</Chip>)}
          </div>
          <p className="mt-0.5 max-w-xl text-xs leading-relaxed text-muted">
            Real-time transcription (whisper.cpp) and speaker diarization with confidence (sherpa-onnx) run fully on your device.
          </p>

          {!isTauri() ? (
            <p className="mt-3 text-xs text-muted">Native engine ships in the desktop/mobile app. This browser preview uses the webview model.</p>
          ) : status === "loading" ? (
            <div className="mt-3 flex items-center gap-2 text-xs text-muted"><Spinner /> Checking…</div>
          ) : status && status.compiled ? (
            <div className="mt-3 space-y-1.5">
              {row("Whisper model", status.whisper_model)}
              {row("Diarization (segmentation)", status.seg_model)}
              {row("Speaker embeddings", status.embed_model)}
              {!status.models_ready && (
                <div className="pt-2">
                  <Button onClick={download} disabled={busy}>{busy ? <Spinner /> : <Download className="h-4 w-4" />} Download models</Button>
                </div>
              )}
              {status.models_ready && <div className="pt-1 text-xs text-accent-strong">Ready — recordings transcribe & diarize on-device.</div>}

              {/* Assistant model — powers the copilot, suggestions and notes. */}
              {llm?.compiled && (
                <div className="mt-3 border-t border-hairline pt-3">
                  <div className="flex items-center gap-2 text-xs">
                    <MessageSquare className="h-3.5 w-3.5 text-accent-strong" />
                    <span className="font-medium text-ink-text">Assistant model</span>
                    <span className="text-muted">· {llm.modelName}</span>
                  </div>
                  {llm.modelReady ? (
                    <div className="mt-1.5 text-xs text-accent-strong">Ready — copilot, suggestions & notes run on-device.</div>
                  ) : llmBusy || llm.downloading ? (
                    <div className="mt-2 space-y-1.5">
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-muted">
                        <div className="h-full rounded-full bg-accent-strong transition-all" style={{ width: `${Math.max(3, llm.progress)}%` }} />
                      </div>
                      <div className="font-mono text-[10.5px] text-muted">Downloading… {Math.round(llm.progress)}%</div>
                    </div>
                  ) : (
                    <div className="pt-2">
                      <Button onClick={downloadLlm} disabled={llmBusy}>
                        {llmBusy ? <Spinner /> : <Download className="h-4 w-4" />} Download assistant (~1 GB)
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="mt-3 flex items-start gap-2 rounded-xl bg-warn-soft px-3 py-2 text-xs text-warn">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              This build was compiled without the native engine. Rebuild with <code className="mx-1">--features native-ai</code> (see docs/NATIVE_AI.md); the webview model is used meanwhile.
            </div>
          )}
          {err && <div className="mt-2 text-xs text-danger">{err}</div>}
        </div>
      </div>
    </Card>
  );
}
