// Browser-capability evaluation for the recorder. Pure function over a plain
// capabilities object so it can be unit-tested without a DOM. The component
// reads the real navigator and feeds it in.

export interface Capabilities {
  getDisplayMedia: boolean; // capture a meeting tab's audio
  getUserMedia: boolean; // microphone
  audioContext: boolean; // decode + process audio
  worker: boolean; // run the model off-thread
}

export interface SupportResult {
  /** Record mic + meeting-tab audio (needs getDisplayMedia). */
  canRecordMeeting: boolean;
  /** Record microphone only. */
  canRecordMic: boolean;
  /** Upload an audio file or try the sample (the lowest common denominator). */
  canTranscribeFile: boolean;
  /** A human-readable warning when something core is missing, else "". */
  warning: string;
}

export function evaluateSupport(c: Capabilities): SupportResult {
  const canTranscribeFile = c.audioContext && c.worker;
  const canRecordMic = canTranscribeFile && c.getUserMedia;
  const canRecordMeeting = canRecordMic && c.getDisplayMedia;

  let warning = "";
  if (!canTranscribeFile) {
    warning =
      "This browser can't run the transcription engine. Use a recent Chrome, Edge or Brave on desktop.";
  } else if (!canRecordMeeting) {
    warning =
      "Capturing meeting-tab audio needs desktop Chrome, Edge or Brave. You can still record your mic or upload an audio file here.";
  }
  return { canRecordMeeting, canRecordMic, canTranscribeFile, warning };
}

/** Read the real browser capabilities (client-side only). */
export function readCapabilities(): Capabilities {
  if (typeof navigator === "undefined") {
    return { getDisplayMedia: false, getUserMedia: false, audioContext: false, worker: false };
  }
  const md = navigator.mediaDevices;
  const w = window as unknown as { AudioContext?: unknown; webkitAudioContext?: unknown };
  return {
    getDisplayMedia: !!(md && md.getDisplayMedia),
    getUserMedia: !!(md && md.getUserMedia),
    audioContext: !!(w.AudioContext || w.webkitAudioContext),
    worker: typeof Worker !== "undefined",
  };
}
