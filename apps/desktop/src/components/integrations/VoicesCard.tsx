// Voice profiles — enrol colleagues' voices (10 s of speech) so the native
// engine can put real names, with confidence, on the transcript. Honest states:
// browser preview → explains it's native-only; native errors surface verbatim.
import { useEffect, useRef, useState } from "react";
import { AudioLines, Mic, Square, Trash2 } from "lucide-react";
import { resample, WHISPER_SAMPLE_RATE, concatFloat32 } from "@parleynotes/core";
import { Button, Card, Chip, ErrorNote, Spinner } from "../ui.tsx";
import { isTauri } from "../../lib/runtime.ts";
import { AudioCapture } from "../../lib/capture.ts";
import { listVoiceProfiles, enrollVoice, deleteVoiceProfile, type VoiceProfileMeta } from "../../lib/nativeAI.ts";

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

  useEffect(() => { void listVoiceProfiles().then(setProfiles); }, []);
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
      const profile = await enrollVoice(name, audio);
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
      await deleteVoiceProfile(id);
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

          {!isTauri() ? (
            <p className="mt-3 text-xs text-muted">Voice identification runs in the desktop/mobile app's native engine — not in the browser preview.</p>
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
                  <span className="pn-pulse h-1.5 w-1.5 rounded-full bg-danger" /> Speak naturally — reading a sentence or two works well.
                </div>
              )}

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
