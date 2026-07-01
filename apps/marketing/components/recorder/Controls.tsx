"use client";

import type { SupportResult } from "@/lib/support";

// The idle (not-recording) control panel: language choice, the three capture
// modes, and the "try a sample" affordance — gated by browser support.
export default function Controls({
  support, lang, onLang, busy, onRecordMeeting, onRecordMic, onUpload, onSample,
}: {
  support: SupportResult;
  lang: string;
  onLang: (l: string) => void;
  busy: boolean;
  onRecordMeeting: () => void;
  onRecordMic: () => void;
  onUpload: (f: File) => void;
  onSample: () => void;
}) {
  return (
    <div className="mt-4 grid gap-2">
      {support.warning && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{support.warning}</p>
      )}

      <label className="flex items-center justify-between rounded-lg bg-stone-50 px-3 py-2 text-xs text-stone-600">
        <span>Model</span>
        <select value={lang} onChange={(e) => onLang(e.target.value)} className="rounded-md border border-stone-300 bg-white px-2 py-1 text-xs">
          <option value="en">English · fast (small download)</option>
          <option value="en-hq">English · accurate (larger)</option>
          <option value="multi">Multilingual</option>
        </select>
      </label>

      <button onClick={onRecordMeeting} disabled={!support.canRecordMeeting || busy}
        className="rounded-xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-40">
        ● Record meeting (mic + meeting tab audio)
      </button>
      <button onClick={onRecordMic} disabled={!support.canRecordMic || busy}
        className="rounded-xl border border-stone-300 px-4 py-2.5 text-sm font-medium hover:bg-stone-50 disabled:opacity-40">
        Record microphone only
      </button>
      <label className={`cursor-pointer rounded-xl border border-dashed border-stone-300 px-4 py-3 text-center text-sm text-stone-600 hover:bg-stone-50 ${(!support.canTranscribeFile || busy) ? "pointer-events-none opacity-40" : ""}`}>
        ⬆ Upload an audio file (MP3, WAV, M4A)
        <input type="file" accept="audio/*" className="hidden" onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])} />
      </label>
      <button onClick={onSample} disabled={!support.canTranscribeFile || busy}
        className="rounded-xl bg-stone-100 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-200 disabled:opacity-40">
        ▶ Try with a sample clip
      </button>
    </div>
  );
}
