// Design tokens — the single source of truth for how Ledgeur looks.
//
// Everything visual starts here. `tokens.css` is GENERATED from this file
// (`pnpm --filter @ledgeur/ui build:theme`) so the CSS the two apps import and
// the values TypeScript reads (canvas visualisers, the social image, native
// window chrome) cannot drift — the test suite fails if the generated file is
// stale. Before this, the desktop app kept a hand copy of the theme and its
// secondary text colour had quietly become 2.86:1.
//
// The system, stated once:
//
//   A neutral canvas — white surfaces on a cool off-white ground, near-black
//   text — with six pastel families. Each family is a triad: a SOFT tint for
//   backgrounds, a BASE for fills and borders, and a STRONG tone that clears
//   WCAG AA as text both on white and on its own tint. Colour is semantic:
//
//     iris    the brand, the copilot, links, focus, selection
//     mint    live, you, sync health, success
//     peach   recording, destructive
//     butter  warnings
//     sky     speakers, spaces, avatars
//     rose    speakers, spaces, avatars
//
//   Two modes. Dark is not an inversion: the tints deepen, the strong tones
//   lighten, and the neutrals follow the same ladder. Both are measured.

/** A pastel family: tint / fill / text. */
export interface Triad {
  soft: string;
  base: string;
  strong: string;
}

export interface Pastels {
  iris: Triad;
  mint: Triad;
  peach: Triad;
  butter: Triad;
  sky: Triad;
  rose: Triad;
}

export interface Neutrals {
  /** The page ground. */
  paper: string;
  /** Cards, inputs, the main canvas. */
  surface: string;
  /** Sidebars, muted panels, your own chat bubble. */
  surfaceMuted: string;
  /** Hover and pressed states, progress tracks. */
  surfaceSunken: string;
  /** The solid primary button and the wordmark tile. Light in dark mode. */
  ink: string;
  inkSoft: string;
  inkRaised: string;
  text: string;
  textMuted: string;
  textFaint: string;
  textOnInk: string;
  textOnInkMuted: string;
  border: string;
  borderStrong: string;
  /** The filled danger button: the strong tone in light (white text on it),
   *  the base in dark (dark text on it) — whichever pairing reads. */
  dangerFill: string;
  /** Text on a filled danger button. */
  onDanger: string;
}

export type Palette = Neutrals & Pastels;

export const LIGHT: Palette = {
  paper: "#f7f7f8",
  surface: "#ffffff",
  surfaceMuted: "#f2f2f4",
  surfaceSunken: "#e8e8ec",
  ink: "#17181c",
  inkSoft: "#26272d",
  inkRaised: "#34363e",
  text: "#141417",
  textMuted: "#5d6069",
  // 4.77:1 on the deepest surface it is ever placed on — measured, and the
  // test keeps it that way.
  textFaint: "#62656e",
  textOnInk: "#ffffff",
  textOnInkMuted: "#b4b7c1",
  border: "#e9e9ee",
  borderStrong: "#d9dae1",
  dangerFill: "#b5401e",
  onDanger: "#ffffff",
  iris: { soft: "#ebe9ff", base: "#8b83f5", strong: "#4d45c4" },
  mint: { soft: "#dcf5ea", base: "#4fcf9f", strong: "#137a50" },
  peach: { soft: "#ffe7de", base: "#ff8a65", strong: "#b5401e" },
  butter: { soft: "#fff1c6", base: "#e5b229", strong: "#7a5300" },
  sky: { soft: "#ddeefe", base: "#63b4f5", strong: "#1b5f9f" },
  rose: { soft: "#ffe2ec", base: "#f47ca7", strong: "#b0295c" },
};

export const DARK: Palette = {
  paper: "#171717",
  surface: "#212121",
  surfaceMuted: "#2a2a2a",
  surfaceSunken: "#343434",
  ink: "#ececec",
  inkSoft: "#e0e0e0",
  inkRaised: "#d4d4d4",
  text: "#ececec",
  textMuted: "#b0b0b5",
  textFaint: "#a1a1a8",
  textOnInk: "#141417",
  textOnInkMuted: "#4c4c52",
  border: "#303030",
  borderStrong: "#3f3f44",
  dangerFill: "#ff8a65",
  onDanger: "#1a0d08",
  iris: { soft: "#2b2a4a", base: "#8b83f5", strong: "#b9b3ff" },
  mint: { soft: "#1f3a30", base: "#4fcf9f", strong: "#7fe3bc" },
  peach: { soft: "#452a22", base: "#ff8a65", strong: "#ffa88c" },
  butter: { soft: "#3f3620", base: "#f5c542", strong: "#f6d271" },
  sky: { soft: "#1f3346", base: "#63b4f5", strong: "#9ed0fa" },
  rose: { soft: "#45252f", base: "#f47ca7", strong: "#ffa3c4" },
};

/**
 * The palette flattened into the names the CSS and the rest of the codebase
 * use. Semantic aliases sit on top of the pastel families so a component says
 * `bg-brand-soft`, not `bg-iris-soft`, and the brand can move without a
 * find-and-replace.
 */
export function flatten(p: Palette): Record<string, string> {
  const out: Record<string, string> = {
    paper: p.paper, surface: p.surface, "surface-muted": p.surfaceMuted, "surface-sunken": p.surfaceSunken,
    ink: p.ink, "ink-soft": p.inkSoft, "ink-raised": p.inkRaised,
    "ink-text": p.text, muted: p.textMuted, faint: p.textFaint,
    "on-ink": p.textOnInk, "on-ink-muted": p.textOnInkMuted,
    hairline: p.border, "hairline-strong": p.borderStrong,
    "on-danger": p.onDanger, "danger-fill": p.dangerFill,
  };
  for (const name of PASTEL_NAMES) {
    const t = p[name];
    out[name] = t.base;
    out[`${name}-soft`] = t.soft;
    out[`${name}-strong`] = t.strong;
  }
  // Semantic aliases.
  out.brand = p.iris.base; out["brand-soft"] = p.iris.soft; out["brand-strong"] = p.iris.strong;
  out.accent = p.mint.base; out["accent-soft"] = p.mint.soft; out["accent-strong"] = p.mint.strong;
  // Danger and warn are used as text far more often than as fills, so the
  // bare name is the strong tone.
  out.danger = p.peach.strong; out["danger-soft"] = p.peach.soft;
  out.warn = p.butter.strong; out["warn-soft"] = p.butter.soft;
  return out;
}

export const PASTEL_NAMES = ["iris", "mint", "peach", "butter", "sky", "rose"] as const;
export type PastelName = (typeof PASTEL_NAMES)[number];

/** The light palette, flat — what most TypeScript callers want. */
export const COLORS = flatten(LIGHT);
export const DARK_COLORS = flatten(DARK);

/**
 * Speaker colours, in order: Speaker 1 → sky, Speaker 2 → rose, and so on,
 * cycling after six. Iris is not among them — it is the copilot's colour, and
 * a speaker who looked like the copilot would read as the machine talking.
 */
export const SPEAKER_ORDER: readonly PastelName[] = ["sky", "rose", "mint", "butter", "peach", "iris"];

export interface SpeakerColour {
  name: PastelName;
  fg: string;
  bg: string;
}

export const SPEAKER_COLORS: readonly SpeakerColour[] = SPEAKER_ORDER.map((name) => ({
  name, fg: LIGHT[name].strong, bg: LIGHT[name].soft,
}));

/** Stable speaker colour from a label like "Speaker 3" or a name. */
export function speakerColor(label: string): SpeakerColour {
  return SPEAKER_COLORS[speakerIndex(label)];
}

/** Which family a label maps to — the same rule in CSS-variable form. */
export function speakerIndex(label: string): number {
  const m = /(\d+)\s*$/.exec(label);
  if (m) return (parseInt(m[1], 10) - 1 + SPEAKER_COLORS.length * 8) % SPEAKER_COLORS.length;
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) | 0;
  return Math.abs(h) % SPEAKER_COLORS.length;
}

/** The family a name lands on, for avatars and speaker marks. Deterministic,
 *  so the same person is the same colour on every device. */
export function pastelFor(label: string): PastelName {
  return SPEAKER_ORDER[speakerIndex(label)];
}

export const FONTS = {
  /** One family for everything read or operated. Display is a weight, not a face. */
  sans: '"Plus Jakarta Sans Variable", "Avenir Next", "Segoe UI", system-ui, sans-serif',
  mono: '"Spline Sans Mono Variable", "SF Mono", ui-monospace, monospace',
} as const;

/**
 * The type scale, in pixels. Twelve steps; `base` is the UI size, `md` is the
 * reading size for transcripts and notes.
 */
export const TYPE_SCALE = {
  "2xs": 11, xs: 12, sm: 13, base: 14, md: 15, lg: 17, xl: 20,
  "2xl": 24, "3xl": 30, "4xl": 38, "5xl": 48, "6xl": 60,
} as const;

/** Radii: controls, cards, sheets, the composer pill. */
export const RADII = {
  sm: "0.5rem",
  md: "0.625rem",
  lg: "0.75rem",
  xl: "1rem",
  "2xl": "1.5rem",
  "3xl": "2rem",
  pill: "999px",
} as const;

/** Soft, layered shadows — never one grey drop. */
export const SHADOWS = {
  card: "0 1px 2px rgb(20 20 30 / 0.04), 0 6px 24px -10px rgb(20 20 30 / 0.10)",
  float: "0 2px 6px rgb(20 20 30 / 0.06), 0 12px 32px -8px rgb(20 20 30 / 0.16)",
  palette: "0 24px 64px -12px rgb(20 20 30 / 0.30)",
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
