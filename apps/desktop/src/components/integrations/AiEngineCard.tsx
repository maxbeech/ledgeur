import { useEffect, useState } from "react";
import { Cpu, Check, Download, AlertCircle } from "lucide-react";
import { Button, Card, Chip, Spinner } from "../ui.tsx";
import { isTauri } from "../../lib/runtime.ts";
import { aiStatus, downloadModels, type NativeAiStatus } from "../../lib/nativeAI.ts";

/** On-device AI engine status + model download. Real state from the Rust core;
 *  in the browser preview it explains that native AI ships in the desktop app. */
export function AiEngineCard() {
  const [status, setStatus] = useState<NativeAiStatus | null | "loading">("loading");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const refresh = () => aiStatus().then((s) => setStatus(s));
  useEffect(() => { refresh(); }, []);

  async function download() {
    setBusy(true); setErr("");
    try { await downloadModels(); await refresh(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
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
            </div>
          ) : (
            <div className="mt-3 flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              This build was compiled without the native engine. Rebuild with <code className="mx-1">--features native-ai</code> (see docs/NATIVE_AI.md); the webview model is used meanwhile.
            </div>
          )}
          {err && <div className="mt-2 text-xs text-red-600">{err}</div>}
        </div>
      </div>
    </Card>
  );
}
