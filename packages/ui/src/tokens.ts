// Design tokens — the single source of truth for the Ledgeur look & feel.
// Aesthetic: "The Library of Record" — dark spruce-ink furniture around warm
// paper pages; serif display type; strict color semantics (emerald = live/you,
// gold = the brain speaking, madder = recording/danger).
// Consumed by CSS (mirrored as @theme custom properties in the app's theme.css)
// and by TypeScript (native window chrome, canvas visualisers, charts).

export const COLORS = {
  // Warm paper backdrop and layered "sheet" surfaces.
  paper: "#f6f2ea",
  surface: "#fdfbf7",
  surfaceMuted: "#efe9de",
  surfaceSunken: "#e9e2d4",
  // Deep spruce "ink" — sidebar, title bars, brand chrome.
  ink: "#0e1f19",
  inkSoft: "#163026",
  inkRaised: "#1d3a2e",
  // Brand accent — emerald. Live things, your actions, sync health.
  accent: "#0f8a63",
  accentStrong: "#0a6b4d",
  accentSoft: "#dcefe5",
  // The brain's voice — burnished gold. AI answers, suggestions, MCP.
  glow: "#a87a24",
  glowStrong: "#805912",
  glowSoft: "#f3e8d2",
  // Recording / destructive — madder red.
  danger: "#a33636",
  dangerSoft: "#f6e0dc",
  /** Madder lifted for the dark chrome. `danger` is 2.55:1 on ink — unreadable —
   *  so the sidebar's recording dot and its label use this instead. */
  dangerOnInk: "#e08a8a",
  warn: "#8f520d",
  warnSoft: "#f5e7d2",
  /** Warn lifted for the dark chrome, for the same reason as dangerOnInk. */
  warnOnInk: "#d9a441",
  // Text. Each clears WCAG AA (4.5:1) on paper and on surface — measured.
  // `accent` and `glow` below do not: they are fills and borders. Coloured
  // *text* uses accentStrong / glowStrong.
  text: "#211d16",
  textMuted: "#685f52",
  textFaint: "#6b6354",
  textOnInk: "#f0ede4",
  textOnInkMuted: "#a9bdb1",
  // Rules & hairlines.
  border: "#e2dacb",
  borderStrong: "#cfc4ae",
} as const;

// Heritage tones for speaker attribution — muted, print-like, distinguishable.
// Order matters: Speaker 1 → moss, Speaker 2 → madder, etc. (cycles after 6).
export const SPEAKER_COLORS = [
  { name: "moss", fg: "#3f6212", bg: "#eef2df" },
  { name: "madder", fg: "#9f3b3b", bg: "#f6e3e0" },
  { name: "indigo", fg: "#3b4a8f", bg: "#e4e7f4" },
  { name: "ochre", fg: "#855708", bg: "#f4ead3" },
  { name: "plum", fg: "#7c3a6d", bg: "#f2e2ee" },
  { name: "teal", fg: "#0f6b74", bg: "#dcedee" },
] as const;

/** Stable speaker color from a label like "Speaker 3" or a name. */
export function speakerColor(label: string): (typeof SPEAKER_COLORS)[number] {
  const m = /(\d+)\s*$/.exec(label);
  if (m) return SPEAKER_COLORS[(parseInt(m[1], 10) - 1 + SPEAKER_COLORS.length * 8) % SPEAKER_COLORS.length];
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) | 0;
  return SPEAKER_COLORS[Math.abs(h) % SPEAKER_COLORS.length];
}

export const FONTS = {
  display: '"Fraunces Variable", "Iowan Old Style", Georgia, serif',
  sans: '"Schibsted Grotesk Variable", "Avenir Next", "Segoe UI", sans-serif',
  mono: '"Spline Sans Mono Variable", "SF Mono", ui-monospace, monospace',
} as const;

export const RADII = {
  sm: "0.5rem",
  md: "0.75rem",
  lg: "1rem",
  xl: "1.25rem",
  pill: "999px",
} as const;

// Motion grammar — calm, precise, "settling" rather than bouncing.
export const MOTION = {
  settle: "cubic-bezier(0.22, 1, 0.36, 1)",
  swift: "cubic-bezier(0.4, 0, 0.2, 1)",
  fast: "140ms",
  base: "240ms",
  slow: "420ms",
} as const;

// Confidence tiers for speaker-identity / ASR likelihood badges.
export function confidenceTier(p: number | null | undefined): "high" | "medium" | "low" | "unknown" {
  if (p == null) return "unknown";
  if (p >= 0.8) return "high";
  if (p >= 0.5) return "medium";
  return "low";
}
