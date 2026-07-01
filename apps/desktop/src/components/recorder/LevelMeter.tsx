// A calm, premium input-level meter. Maps RMS (0..~0.4) to a row of bars.
export function LevelMeter({ level }: { level: number }) {
  const bars = 28;
  const active = Math.min(bars, Math.round((level / 0.35) * bars));
  return (
    <div className="flex h-8 items-end gap-[3px]" aria-hidden>
      {Array.from({ length: bars }).map((_, i) => {
        const on = i < active;
        const h = 20 + Math.sin((i / bars) * Math.PI) * 60; // gentle arc
        return (
          <span
            key={i}
            className={on ? "bg-accent" : "bg-hairline"}
            style={{ width: 3, height: `${on ? h : 26}%`, borderRadius: 2, transition: "height 90ms ease, background 120ms" }}
          />
        );
      })}
    </div>
  );
}
