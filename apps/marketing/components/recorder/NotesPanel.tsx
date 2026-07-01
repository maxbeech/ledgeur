"use client";

import { useEffect, useState } from "react";
import { summarizeTranscript, notesToMarkdown } from "@/lib/summarize";
import { AI_PROVIDERS, generateAiNotes, providerById } from "@/lib/ai-notes";
import { saveMeeting, type Meeting } from "@/lib/db";
import SavedMeetings from "./SavedMeetings";

const KEY_STORE = "parleynotes.aikey";

export default function NotesPanel({ transcript, durationSec }: { transcript: string; durationSec: number }) {
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [title, setTitle] = useState("Untitled meeting");
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [providerId, setProviderId] = useState("openai");
  const [apiKey, setApiKey] = useState("");
  const [reloadFlag, setReloadFlag] = useState(0);

  // Load saved AI-key prefs on mount. localStorage is unavailable during SSR,
  // so this must run in an effect (not a lazy initializer) to stay hydration-safe.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY_STORE);
      if (raw) {
        const v = JSON.parse(raw);
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setProviderId(v.providerId || "openai");
        setApiKey(v.apiKey || "");
      }
    } catch { /* ignore */ }
  }, []);

  const persistKey = (pid: string, key: string) => {
    setProviderId(pid); setApiKey(key);
    try { localStorage.setItem(KEY_STORE, JSON.stringify({ providerId: pid, apiKey: key })); } catch { /* ignore */ }
  };

  const localNotes = () => {
    setErr(null);
    const n = summarizeTranscript(transcript);
    setNotes(notesToMarkdown(title, new Date().toISOString().slice(0, 10), n, transcript));
  };

  const aiNotes = async () => {
    setErr(null);
    if (!apiKey) { setShowKey(true); return; }
    setBusy(true);
    try {
      const md = await generateAiNotes({ provider: providerById(providerId), apiKey, transcript });
      setNotes(`# ${title}\n\n_${new Date().toISOString().slice(0, 10)}_\n\n${md}\n\n## Transcript\n\n${transcript.trim()}\n`);
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  const save = async () => {
    const m: Meeting = {
      id: (globalThis.crypto?.randomUUID?.() ?? String(Date.now())),
      title, dateISO: new Date().toISOString(), transcript,
      notesMarkdown: notes || notesToMarkdown(title, new Date().toISOString().slice(0, 10), summarizeTranscript(transcript), transcript),
      durationSec,
    };
    await saveMeeting(m);
    setSaved(true); setReloadFlag((n) => n + 1);
    setTimeout(() => setSaved(false), 2000);
  };

  const copyNotes = () => {
    const md = notes || notesToMarkdown(title, new Date().toISOString().slice(0, 10), summarizeTranscript(transcript), transcript);
    navigator.clipboard?.writeText(md).then(() => { setCopied("notes"); setTimeout(() => setCopied(null), 1500); });
  };

  const download = () => {
    const md = notes || "# " + title + "\n\n" + transcript;
    const blob = new Blob([md], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${title.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "meeting"}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const has = transcript.trim().length > 0;

  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">Notes</h2>
        <button onClick={() => setShowKey((s) => !s)} className="text-xs text-stone-600 underline-offset-2 hover:underline">
          {apiKey ? "AI key set" : "Add AI key"}
        </button>
      </div>

      {showKey && (
        <div className="mt-3 rounded-xl bg-stone-50 p-3 text-sm">
          <p className="text-xs text-stone-600">Optional — for AI-written notes. Your key stays in this browser and the transcript goes straight to your provider, never to us.</p>
          <div className="mt-2 flex gap-2">
            <select aria-label="AI provider" value={providerId} onChange={(e) => persistKey(e.target.value, apiKey)} className="rounded-lg border border-stone-300 px-2 py-1.5 text-sm">
              {AI_PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
            <input aria-label="API key" type="password" value={apiKey} onChange={(e) => persistKey(providerId, e.target.value)} placeholder={providerById(providerId).keyHint}
              className="flex-1 rounded-lg border border-stone-300 px-2 py-1.5 text-sm" />
          </div>
        </div>
      )}

      <input aria-label="Meeting title" value={title} onChange={(e) => setTitle(e.target.value)} className="mt-3 w-full rounded-lg border border-stone-200 px-3 py-2 text-sm font-medium" />

      <div className="mt-3 flex flex-wrap gap-2">
        <button disabled={!has} onClick={localNotes} className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-40">
          Generate notes (free, on-device)
        </button>
        <button disabled={!has || busy} onClick={aiNotes} className="rounded-lg border border-stone-300 px-3 py-2 text-sm font-medium hover:bg-stone-50 disabled:opacity-40">
          {busy ? "Writing…" : "AI notes (your key)"}
        </button>
      </div>
      {err && <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</p>}

      <textarea aria-label="Generated notes (Markdown)" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Generated notes appear here (editable Markdown)…"
        className="mt-3 h-60 w-full resize-y rounded-xl border border-stone-200 bg-stone-50 p-3 font-mono text-xs leading-relaxed outline-none focus:border-emerald-400" />

      <div className="mt-3 flex gap-2">
        <button disabled={!has} onClick={save} className="rounded-lg bg-stone-900 px-3 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-40">
          {saved ? "Saved ✓" : "Save to this browser"}
        </button>
        <button disabled={!notes && !has} onClick={copyNotes} className="rounded-lg border border-stone-300 px-3 py-2 text-sm font-medium hover:bg-stone-50 disabled:opacity-40">
          {copied === "notes" ? "Copied ✓" : "Copy"}
        </button>
        <button disabled={!notes && !has} onClick={download} className="rounded-lg border border-stone-300 px-3 py-2 text-sm font-medium hover:bg-stone-50 disabled:opacity-40">
          Export .md
        </button>
      </div>

      <SavedMeetings reloadFlag={reloadFlag} />
    </div>
  );
}
