// Voice profiles — enrol a colleague's voice with about ten seconds of speech,
// and transcripts name that person instead of "Speaker 2".
//
// This used to be native-only, and said so. Since the webview gained speaker
// separation it recognises voices too, so enrolment now goes to whichever store
// the engine in *this* build will actually read (see lib/voiceProfiles.ts).
// Errors surface verbatim rather than being smoothed over.
import { useEffect, useRef, useState } from "react";
import { AudioLines, Mic, Square, Trash2 } from "lucide-react";
import { resample, WHISPER_SAMPLE_RATE, concatFloat32 } from "@ledgeur/core";
import { Button, Card, Chip, ErrorNote, Spinner } from "../ui.tsx";
import { AudioCapture } from "@ledgeur/core/browser";
import {
  activeEngine, listProfiles, enrollProfile, deleteProfile, type VoiceProfileMeta,
} from "../../lib/voiceProfiles.ts";

const TARGET_SECONDS = 10;

export function VoicesCard() {
  const [profiles, setProfiles] = useState<VoiceProfileMeta[] | null>(null);
  const [name, setName] = useState("");
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const capture = useRef<AudioCapture | null>(null);
  const chunks = useRef<Float32Array[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const [engine, setEngine] = useState<"native" | "webview" | null>(null);
  useEffect(() => { void listProfiles().then(setProfiles); void activeEngine().then(setEngine); }, []);
  useEffect(() => () => { // teardown on unmount
    if (timer.current) clearInterval(timer.current);
    void capture.current?.stop();
  }, []);

  async function startEnrol() {
    setErr("");
    try {
      const cap = new AudioCapture();
      await cap.start({ mic: true, system: false });
      capture.current = cap;
      chunks.current = [];
      setSeconds(0);
      setRecording(true);
      timer.current = setInterval(() => {
        chunks.current.push(cap.drainNew());
        const s = cap.totalSeconds();
        setSeconds(s);
        if (s >= TARGET_SECONDS) void finishEnrol();
      }, 500);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function finishEnrol() {
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
    const cap = capture.current;
    if (!cap) return;
    chunks.current.push(cap.drainNew());
    const rate = cap.sampleRate;
    await cap.stop();
    capture.current = null;
    setRecording(false);
    setBusy(true);
    try {
      const audio = resample(concatFloat32(chunks.current), rate, WHISPER_SAMPLE_RATE);
      const profile = await enrollProfile(name, audio);
      setProfiles((p) => [...(p ?? []), profile]);
      setName("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      chunks.current = [];
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setErr("");
    try {
      await deleteProfile(id);
      setProfiles((p) => (p ?? []).filter((x) => x.id !== id));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Card className="p-5">
      <div className="flex items-start gap-3">
        <AudioLines className="mt-0.5 h-5 w-5 shrink-0 text-accent-strong" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-ink-text">Voice profiles</span>
            <Chip tone="accent">speaker ID</Chip>
          </div>
          <p className="mt-0.5 max-w-xl text-xs leading-relaxed text-muted">
            Enrol a voice with ~10 seconds of speech and transcripts name that person — with a confidence figure — instead of “Speaker 2”. Voice prints never leave this device.
          </p>

          {engine === null ? (
            <p className="mt-3 text-xs text-muted">Checking which engine this build uses…</p>
          ) : (
            <>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  name="voice-name" placeholder="Who is this? e.g. Priya (Design)"
                  disabled={recording || busy}
                  className="w-56 rounded-lg border border-hairline bg-surface px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-accent/40"
                />
                {recording ? (
                  <Button size="sm" variant="danger" onClick={() => void finishEnrol()}>
                    <Square className="h-3.5 w-3.5" fill="currentColor" />
                    Stop · {Math.max(0, TARGET_SECONDS - Math.floor(seconds))}s
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => void startEnrol()} disabled={!name.trim() || busy}>
                    {busy ? <Spinner /> : <Mic className="h-3.5 w-3.5" />} {busy ? "Enrolling…" : "Record voice"}
                  </Button>
                )}
              </div>
              {recording && (
                <div className="mt-2 flex items-center gap-2 font-mono text-[10.5px] text-danger">
                  <span className="ldg-pulse h-1.5 w-1.5 rounded-full bg-danger" /> Speak naturally — reading a sentence or two works well.
                </div>
              )}

              {/* Which engine is doing the recognising, because the two use
                  different models and therefore different, incompatible voice
                  prints. Somebody whose profiles "disappeared" after rebuilding
                  with the native engine deserves to know why. */}
              <p className="mt-2 text-[11px] text-faint">
                {engine === "native"
                  ? "Recognised by the native engine. These prints are stored on this machine and are separate from the ones the webview engine makes."
                  : "Recognised by the speaker models in the webview. These prints are stored in this app's local storage; a build with the native engine uses its own, and will not see them."}
              </p>

              {(profiles ?? []).length > 0 && (
                <ul className="mt-4 divide-y divide-hairline border-t border-hairline">
                  {(profiles ?? []).map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-medium text-ink-text">{p.name}</div>
                        <div className="font-mono text-[10px] text-faint">
                          enrolled {p.created_at ? new Date(p.created_at * 1000).toLocaleDateString() : "—"}
                        </div>
                      </div>
                      <button onClick={() => void remove(p.id)} className="text-faint transition-colors hover:text-danger" aria-label={`Delete ${p.name}`}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          {err && <ErrorNote className="mt-3">{err}</ErrorNote>}
        </div>
      </div>
    </Card>
  );
}
