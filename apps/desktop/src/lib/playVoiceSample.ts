// Playing back a stored voice sample — the couple of seconds of someone
// speaking that `chooseVoiceSnippet` (@ledgeur/core) kept so a voice can be
// recognised in a later meeting. Until now it was only ever fed to the
// enrolment model; this is what lets a person actually hear it, e.g. before
// confirming "is this you?" while naming a speaker.
//
// The sample is raw 16 kHz mono PCM, because that is what both speaker
// engines want — not something an <audio> element can play directly, so it is
// wrapped in a WAV header first (pure, in @ledgeur/core, and unit-tested
// there). Everything below is the DOM plumbing that only makes sense in a
// browser: building a Blob URL, playing it, and — the part pure code cannot
// own — making sure only one snippet is ever audible at once and that the
// Blob URL behind it is always revoked, not leaked.

import { pcm16ToWav } from "@ledgeur/core";
import type { LocalVoiceSample } from "./meetingsStore.ts";

let current: HTMLAudioElement | null = null;
let currentUrl: string | null = null;

/** Stop whatever snippet is currently playing and release its Blob URL. Safe
 *  to call when nothing is playing. */
export function stopVoiceSample(): void {
  if (current) {
    current.pause();
    current.removeAttribute("src");
    current = null;
  }
  if (currentUrl) {
    URL.revokeObjectURL(currentUrl);
    currentUrl = null;
  }
}

/**
 * Play a stored voice sample from the start.
 *
 * Call this from a click handler, not an effect: browsers require a recent
 * user gesture to allow audio to play, and a button the person just pressed
 * to hear "is this them?" is exactly that gesture.
 */
export function playVoiceSample(sample: LocalVoiceSample): void {
  stopVoiceSample();
  const bytes = pcm16ToWav(sample.pcm, sample.sampleRate);
  const url = URL.createObjectURL(new Blob([bytes.buffer as ArrayBuffer], { type: "audio/wav" }));
  const audio = new Audio(url);
  current = audio;
  currentUrl = url;
  audio.addEventListener("ended", stopVoiceSample, { once: true });
  void audio.play().catch(stopVoiceSample);
}
