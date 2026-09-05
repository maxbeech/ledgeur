// The live input level, kept deliberately outside React state.
//
// `AudioCapture.onLevel` fires once per ScriptProcessor block — roughly twelve
// times a second at 48 kHz — and the level used to live on the recorder's state
// object. Every one of those ticks therefore re-rendered the whole live meeting:
// the transcript, every chat bubble, the notes panel. During a long meeting that
// is hundreds of full re-renders a minute for a two-pixel bar, and it is exactly
// what made the UI feel sluggish while recording.
//
// A meter is not application state, so it isn't stored as any. This is a module
// store that only <LevelMeter> subscribes to, so a level tick re-renders a
// single leaf component and nothing else.

import { useSyncExternalStore } from "react";

let level = 0;
const listeners = new Set<() => void>();

/**
 * Publish a new level. Quantised to 1/200ths before it's allowed to wake
 * anybody up: the raw RMS jitters in the sixth decimal place between otherwise
 * identical frames, and re-rendering for a change no eye can see is the same
 * waste in a smaller package.
 */
export function setAudioLevel(next: number): void {
  const rounded = Math.round(Math.max(0, Math.min(1, next)) * 200) / 200;
  if (rounded === level) return;
  level = rounded;
  listeners.forEach((l) => l());
}

export function getAudioLevel(): number {
  return level;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Subscribe a component — in practice only the meter itself. */
export function useAudioLevel(): number {
  return useSyncExternalStore(subscribe, getAudioLevel, getAudioLevel);
}
