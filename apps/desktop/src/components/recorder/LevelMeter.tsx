// The live input meter: a scrolling waveform of emerald bars that remembers the
// last few seconds — calm at silence, alive when the room speaks.
import { useEffect, useRef, useState } from "react";

const BARS = 48;

export function LevelMeter({ level }: { level: number }) {
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
            className="pn-eq-bar w-[3px] rounded-full"
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
