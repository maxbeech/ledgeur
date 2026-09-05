// The live input meter: a scrolling waveform of emerald bars that remembers the
// last few seconds — calm at silence, alive when the room speaks.
//
// Reads the level straight from the audio store rather than taking it as a prop.
// As a prop it had to live on the recorder's state, so every level tick (a dozen
// a second) re-rendered the entire live meeting — transcript, chat bubbles and
// all — to move one bar. Subscribing here keeps that churn inside this
// component, which is the only thing that ever needed it.
import { useEffect, useRef, useState } from "react";
import { useAudioLevel } from "../../lib/audioLevel.ts";

const BARS = 48;

export function LevelMeter() {
  const level = useAudioLevel();
  const [history, setHistory] = useState<number[]>(() => Array(BARS).fill(0));
  const latest = useRef(level);
  latest.current = level;

  // Sample the level on a steady clock so bar speed is framerate-independent.
  useEffect(() => {
    const id = setInterval(() => {
      setHistory((h) => [...h.slice(1), Math.min(1, latest.current / 0.3)]);
    }, 120);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex h-10 items-center gap-[3px]" aria-hidden>
      {history.map((v, i) => {
        const recency = i / (BARS - 1); // older bars fade
        return (
          <span
            key={i}
            className="ldg-eq-bar w-[3px] rounded-full"
            style={{
              height: `${8 + v * 84}%`,
              backgroundColor: v > 0.02
                ? `color-mix(in srgb, var(--color-accent) ${Math.round(35 + recency * 65)}%, var(--color-hairline))`
                : "var(--color-hairline)",
            }}
          />
        );
      })}
    </div>
  );
}
