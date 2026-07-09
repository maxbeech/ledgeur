// Speaker attribution mark: heritage-toned small-caps name with an optional
// identity-confidence figure (shown only when the engine really produced one).
import { speakerColor, confidenceTier } from "@ledgeur/ui";

export function SpeakerTag({ label, confidence }: { label: string; confidence?: number | null }) {
  const c = speakerColor(label);
  const tier = confidenceTier(confidence);
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span
        className="rounded-md px-1.5 py-0.5 font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em]"
        style={{ color: c.fg, backgroundColor: c.bg }}
      >
        {label}
      </span>
      {tier !== "unknown" && (
        <span
          className="font-mono text-[10px] tabular-nums text-faint"
          title={`Speaker identity confidence: ${Math.round((confidence ?? 0) * 100)}%`}
        >
          {Math.round((confidence ?? 0) * 100)}%
        </span>
      )}
    </span>
  );
}
