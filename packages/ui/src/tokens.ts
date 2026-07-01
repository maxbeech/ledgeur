// Design tokens — the single source of truth for the ParleyNotes look & feel.
// Consumed by CSS (mirrored as custom properties in the app's theme.css) and by
// TypeScript (native window chrome, charts, canvas visualisers).

export const COLORS = {
  // Warm paper backdrop and layered surfaces.
  paper: "#f7f4ef",
  surface: "#ffffff",
  surfaceMuted: "#f1ede6",
  // Deep graphite-green "ink" used for the sidebar / brand chrome.
  ink: "#10201b",
  inkSoft: "#1b3029",
  // Brand accent — emerald, AA-safe on paper at 700.
  accent: "#0b8f68",
  accentStrong: "#047857",
  accentSoft: "#d5efe6",
  // Secondary highlight for "brain / intelligence" moments.
  glow: "#b8892b",
  // Text.
  text: "#1c1917",
  textMuted: "#57534e",
  textOnInk: "#eef2f0",
  textOnInkMuted: "#9db3aa",
  // Feedback.
  danger: "#b91c1c",
  warn: "#b45309",
  border: "#e6e0d7",
} as const;

export const RADII = {
  sm: "0.5rem",
  md: "0.75rem",
  lg: "1rem",
  xl: "1.25rem",
  pill: "999px",
} as const;

// Confidence tiers for speaker-identity / ASR likelihood badges.
export function confidenceTier(p: number | null | undefined): "high" | "medium" | "low" | "unknown" {
  if (p == null) return "unknown";
  if (p >= 0.8) return "high";
  if (p >= 0.5) return "medium";
  return "low";
}
