"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TranscriberController } from "./recorder/transcriber";
import { AudioCapture } from "./recorder/capture";
import Controls from "./recorder/Controls";
import NotesPanel from "./recorder/NotesPanel";
import { resample, rms, WHISPER_SAMPLE_RATE } from "@/lib/audio";
import { evaluateSupport, readCapabilities, type SupportResult } from "@/lib/support";
import { SITE } from "@/lib/site";

type ModelState = "idle" | "loading" | "ready";
const CHUNK_MS = 20000; // transcribe every 20s of speech for a live feel
const DRAFT_KEY = "parleynotes.draft"; // autosave of the working transcript

export default function Recorder() {
  const [model, setModel] = useState<ModelState>("idle");
  const [device, setDevice] = useState("");
  const [progress, setProgress] = useState(0);
  const [recording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [working, setWorking] = useState(false);
  const [level, setLevel] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [lang, setLang] = useState("en");
  const [copied, setCopied] = useState(false);
  const [support, setSupport] = useState<SupportResult>({
    canRecordMeeting: true, canRecordMic: true, canTranscribeFile: true, warning: "",
  });
  const [draft, setDraft] = useState("");

  const trans = useRef<TranscriberController | null>(null);
  const cap = useRef<AudioCapture | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const busy = useRef(false);
  const langRef = useRef("en");

  // Detect real browser capabilities on mount. navigator is unavailable during
  // SSR, so we start optimistic and correct on the client (hydration-safe).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setSupport(evaluateSupport(readCapabilities())); }, []);
  useEffect(() => { langRef.current = lang; }, [lang]);

  // Autosave the working transcript so a tab reload / crash doesn't lose it.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { try { const d = localStorage.getItem(DRAFT_KEY); if (d) setDraft(d); } catch { /* ignore */ } }, []);
  useEffect(() => { try { if (transcript) localStorage.setItem(DRAFT_KEY, transcript); } catch { /* ignore */ } }, [transcript]);

  const getTranscriber = useCallback(() => {
    if (!trans.current) {
      trans.current = new TranscriberController({
        onDevice: (d) => setDevice(d),
        onProgress: (_f, p) => setProgress(p),
        onReady: () => setModel("ready"),
      });
    }
    return trans.current;
  }, []);

  useEffect(() => () => { trans.current?.dispose(); cap.current?.stop(); if (timer.current) clearInterval(timer.current); }, []);

  const loadModel = useCallback(() => {
    if (model !== "idle") return;
    setModel("loading"); setError(null);
    getTranscriber().preload(langRef.current);
  }, [model, getTranscriber]);

  const transcribeBuffer = useCallback(async (audio: Float32Array, rate: number) => {
    const pcm = resample(audio, rate, WHISPER_SAMPLE_RATE);
    return getTranscriber().transcribe(pcm, langRef.current);
  }, [getTranscriber]);

  const tick = useCallback(async () => {
    const c = cap.current;
    if (!c || busy.current) return;
    const fresh = c.drainNew();
    if (fresh.length < c.sampleRate * 2 || rms(fresh) < 0.004) return; // skip <2s / silence
    busy.current = true;
    try {
      const text = await transcribeBuffer(fresh, c.sampleRate);
      if (text) setTranscript((t) => (t ? t + " " : "") + text);
    } catch (e) { setError(String((e as Error).message)); }
    finally { busy.current = false; }
  }, [transcribeBuffer]);

  const start = useCallback(async (mic: boolean, tab: boolean) => {
    setError(null);
    if (model === "idle") loadModel();
    const c = new AudioCapture();
    c.onLevel = (r) => setLevel(r);
    try { await c.start({ mic, tab }); }
    catch (e) { setError((e as Error).message); return; }
    cap.current = c;
    setRecording(true); setElapsed(0);
    let last = 0;
    timer.current = setInterval(() => {
      setElapsed(Math.floor(c.totalSeconds()));
      const now = c.totalSeconds() * 1000;
      if (now - last >= CHUNK_MS) { last = now; void tick(); }
    }, 1000);
  }, [model, loadModel, tick]);

  const stop = useCallback(async () => {
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
    setRecording(false);
    const c = cap.current;
    if (!c) return;
    setWorking(true);
    try {
      const fresh = c.drainNew();
      if (fresh.length > c.sampleRate && rms(fresh) > 0.003) {
        const text = await transcribeBuffer(fresh, c.sampleRate);
        if (text) setTranscript((t) => (t ? t + " " : "") + text);
      }
    } catch (e) { setError(String((e as Error).message)); }
    await c.stop(); cap.current = null; setLevel(0); setWorking(false);
  }, [transcribeBuffer]);

  const transcribeBytes = useCallback(async (bytes: ArrayBuffer) => {
    if (model === "idle") loadModel();
    setWorking(true); setTranscript("");
    try {
      const { audio, sampleRate } = await AudioCapture.decodeArrayBuffer(bytes);
      setTranscript(await transcribeBuffer(audio, sampleRate));
    } catch (e) { setError((e as Error).message || "Could not read that audio."); }
    setWorking(false);
  }, [model, loadModel, transcribeBuffer]);

  const onFile = useCallback(async (file: File) => { setError(null); await transcribeBytes(await file.arrayBuffer()); }, [transcribeBytes]);
  const onSample = useCallback(async () => {
    setError(null);
    try { await transcribeBytes(await fetch(SITE.sampleAudioUrl).then((r) => r.arrayBuffer())); }
    catch { setError("Could not fetch the sample clip — check your connection."); setWorking(false); }
  }, [transcribeBytes]);

  const copyTranscript = useCallback(() => {
    navigator.clipboard?.writeText(transcript).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  }, [transcript]);

  const mins = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">Record or upload</h2>
          {model === "ready" && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">Model ready{device ? ` · ${device}` : ""}</span>}
          {model === "loading" && <span className="text-xs text-stone-600">Downloading model (one-time)… {progress}%</span>}
        </div>

        {!recording ? (
          <Controls support={support} lang={lang} onLang={setLang} busy={working}
            onRecordMeeting={() => start(true, true)} onRecordMic={() => start(true, false)}
            onUpload={onFile} onSample={onSample} />
        ) : (
          <div className="mt-4">
            <div className="flex items-center gap-3">
              <span className="rec-dot text-rose-500">●</span>
              <span className="font-mono text-lg tabular-nums">{mins}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-stone-100">
                <div className="h-full bg-emerald-500 transition-[width] duration-150" style={{ width: `${Math.min(100, Math.round(level * 400))}%` }} />
              </div>
            </div>
            <button onClick={stop} className="mt-4 w-full rounded-xl bg-stone-900 px-4 py-3 text-sm font-semibold text-white hover:bg-stone-700">■ Stop & finish</button>
          </div>
        )}

        {!recording && !working && draft && !transcript && (
          <div className="mt-3 flex items-center justify-between gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <span>You have an unsaved transcript from earlier.</span>
            <span className="flex shrink-0 gap-3">
              <button onClick={() => { setTranscript(draft); setDraft(""); }} className="font-semibold underline">Restore</button>
              <button aria-label="Dismiss" onClick={() => { setDraft(""); try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ } }}>✕</button>
            </span>
          </div>
        )}
        {working && <p className="mt-3 text-sm text-stone-600">Transcribing on your device…</p>}
        {error && <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
        <p className="mt-4 text-xs text-stone-600">
          Tip: when sharing your meeting tab, tick <b>“Share tab audio”</b> so the other participants are captured. Audio never leaves your browser.
        </p>

        <div className="mt-5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-stone-700">Transcript</h3>
            {transcript && <button onClick={copyTranscript} className="text-xs text-stone-600 hover:text-stone-900">{copied ? "Copied ✓" : "Copy"}</button>}
          </div>
          <textarea aria-label="Transcript" value={transcript} onChange={(e) => setTranscript(e.target.value)}
            placeholder="Your transcript will appear here as you record…"
            className="mt-2 h-56 w-full resize-y rounded-xl border border-stone-200 bg-stone-50 p-3 text-sm leading-relaxed outline-none focus:border-emerald-400" />
        </div>
      </div>

      <NotesPanel transcript={transcript} durationSec={elapsed} />
    </div>
  );
}
