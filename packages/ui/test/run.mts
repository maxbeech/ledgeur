// @ledgeur/ui test suite — the design system's own guardrails.
//
// Three things are asserted here that no amount of care would otherwise keep
// true:
//
//  1. tokens.css is exactly what tokens.ts generates. TypeScript reads one and
//     Tailwind reads the other; before the CSS was generated, the desktop app
//     kept a hand copy whose secondary text colour had drifted to 2.86:1.
//  2. Every colour meant for text clears WCAG AA on every surface it is ever
//     placed on — in BOTH modes. A dark palette that was "an inversion" would
//     fail this in a dozen places.
//  3. Every pastel family reads as text on its own tint, because that is how
//     every badge, chip, avatar and speaker mark is built.

import { readFileSync } from "node:fs";
import {
  LIGHT, DARK, COLORS, DARK_COLORS, PASTEL_NAMES, SPEAKER_COLORS, SPEAKER_ORDER, speakerColor, speakerIndex,
  pastelFor, confidenceTier, FONTS, TYPE_SCALE, RADII, type Palette,
} from "../src/tokens.ts";
import { renderThemeCss, TOKENS_CSS_PATH } from "../build-theme.mts";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.error(`  FAIL ${name} ${detail}`); }
};

// ---------- the generated stylesheet is current ----------
const committed = readFileSync(TOKENS_CSS_PATH, "utf8");
ok("tokens.css matches tokens.ts (run `pnpm --filter @ledgeur/ui build:theme`)", committed === renderThemeCss());
ok("the generated file says it is generated", committed.startsWith("/* GENERATED"));
ok("the theme is declared inline so utilities follow the mode", committed.includes("@theme inline"));
ok("dark mode follows the system", committed.includes("prefers-color-scheme: dark"));
ok("dark mode can be forced", committed.includes('[data-theme="dark"]'));
ok("light mode can be forced over a dark system", committed.includes(':root:not([data-theme="light"])'));
for (const k of Object.keys(COLORS)) {
  ok(`--color-${k} is a utility token`, committed.includes(`--color-${k}: var(--ldg-${k});`));
}
ok("the type scale is in the theme", Object.keys(TYPE_SCALE).every((k) => committed.includes(`--text-${k}: ${TYPE_SCALE[k as keyof typeof TYPE_SCALE]}px;`)));
ok("the radii are in the theme", Object.keys(RADII).every((k) => committed.includes(`--radius-${k}:`)));
ok("the sans face is in the theme", committed.includes(`--font-sans: ${FONTS.sans};`));
ok("both palettes have the same keys",
  JSON.stringify(Object.keys(COLORS)) === JSON.stringify(Object.keys(DARK_COLORS)));

const theme = readFileSync(new URL("../src/theme.css", import.meta.url), "utf8");
ok("theme.css imports the generated tokens rather than restating them", theme.includes('@import "./tokens.css"'));
ok("theme.css declares no colours of its own", !/#[0-9a-f]{6}\b/i.test(theme.replace(/\/\*[\s\S]*?\*\//g, "")));

// ---------- contrast ----------
function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
function contrast(a: string, b: string): number {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
const AA = 4.5;
const AA_LARGE = 3;

function checkPalette(mode: string, p: Palette) {
  // Text colours, on every surface they are ever placed on.
  for (const token of ["text", "textMuted", "textFaint"] as const) {
    for (const bg of ["paper", "surface", "surfaceMuted", "surfaceSunken"] as const) {
      ok(`${mode}: ${token} on ${bg} clears AA`, contrast(p[token], p[bg]) >= AA, `${contrast(p[token], p[bg]).toFixed(2)}:1`);
    }
  }
  // The solid button and the wordmark tile.
  for (const token of ["textOnInk", "textOnInkMuted"] as const) {
    for (const bg of ["ink", "inkSoft", "inkRaised"] as const) {
      ok(`${mode}: ${token} on ${bg} clears AA`, contrast(p[token], p[bg]) >= AA, `${contrast(p[token], p[bg]).toFixed(2)}:1`);
    }
  }
  ok(`${mode}: the primary button clears AA`, contrast(p.textOnInk, p.ink) >= AA);
  ok(`${mode}: the danger button clears AA`, contrast(p.onDanger, p.dangerFill) >= AA, `${contrast(p.onDanger, p.dangerFill).toFixed(2)}:1`);
  ok(`${mode}: white on the brand tile clears AA for large text`, contrast("#ffffff", p.iris.base) >= AA_LARGE, `${contrast("#ffffff", p.iris.base).toFixed(2)}:1`);

  // Every pastel family: the strong tone is text on white, on the ground, and
  // on its own tint; ordinary text also reads on the tint (notices).
  for (const name of PASTEL_NAMES) {
    const t = p[name];
    ok(`${mode}: ${name}.strong on surface clears AA`, contrast(t.strong, p.surface) >= AA, `${contrast(t.strong, p.surface).toFixed(2)}:1`);
    ok(`${mode}: ${name}.strong on paper clears AA`, contrast(t.strong, p.paper) >= AA, `${contrast(t.strong, p.paper).toFixed(2)}:1`);
    ok(`${mode}: ${name}.strong on ${name}.soft clears AA`, contrast(t.strong, t.soft) >= AA, `${contrast(t.strong, t.soft).toFixed(2)}:1`);
    ok(`${mode}: text on ${name}.soft clears AA`, contrast(p.text, t.soft) >= AA, `${contrast(p.text, t.soft).toFixed(2)}:1`);
    ok(`${mode}: ${name}.base is visible as a fill on surface`, contrast(t.base, p.surface) >= 1.6, `${contrast(t.base, p.surface).toFixed(2)}:1`);
  }
  ok(`${mode}: hairlines are visible`, contrast(p.border, p.surface) >= 1.08);
  ok(`${mode}: the six families are distinct`, new Set(PASTEL_NAMES.map((n) => p[n].strong)).size === PASTEL_NAMES.length);
}
checkPalette("light", LIGHT);
checkPalette("dark", DARK);

// ---------- speaker colours ----------
ok("speakers use six families", SPEAKER_COLORS.length === 6);
ok("the copilot's family is not the first speaker colour", SPEAKER_ORDER[0] !== "iris",
  "a speaker who looked like the copilot would read as the machine talking");
for (const c of SPEAKER_COLORS) {
  ok(`speaker colour ${c.name} is legible on its own tint`, contrast(c.fg, c.bg) >= AA, `${contrast(c.fg, c.bg).toFixed(2)}:1`);
}
ok("speaker colours are distinct", new Set(SPEAKER_COLORS.map((c) => c.fg)).size === SPEAKER_COLORS.length);
ok("Speaker 1 is the first colour", speakerColor("Speaker 1").name === SPEAKER_COLORS[0].name);
ok("Speaker 2 differs from Speaker 1", speakerColor("Speaker 2").name !== speakerColor("Speaker 1").name);
ok("speaker colours cycle past the palette length",
  speakerColor(`Speaker ${SPEAKER_COLORS.length + 1}`).name === SPEAKER_COLORS[0].name);
ok("a named speaker gets a stable colour", speakerColor("Priya").name === speakerColor("Priya").name);
ok("a named speaker still gets a real colour", SPEAKER_COLORS.some((c) => c.name === speakerColor("Priya").name));
ok("an empty label does not crash", typeof speakerColor("").name === "string");
ok("the CSS index and the TS colour agree", speakerColor("Speaker 3").name === SPEAKER_ORDER[speakerIndex("Speaker 3")]);
ok("an avatar and a speaker mark for the same name share a family", pastelFor("Priya") === speakerColor("Priya").name);
for (let i = 0; i < 6; i++) {
  ok(`theme.css styles speaker family ${i}`, theme.includes(`.ldg-speaker-${i}`));
}

// ---------- confidence tiers ----------
ok("high confidence is high", confidenceTier(0.9) === "high");
ok("the AA of confidence, 0.8, is high", confidenceTier(0.8) === "high");
ok("middling confidence is medium", confidenceTier(0.6) === "medium");
ok("low confidence is low", confidenceTier(0.2) === "low");
ok("no confidence is unknown", confidenceTier(null) === "unknown" && confidenceTier(undefined) === "unknown");

// ---------- the stylesheet's own promises ----------
ok("reduced motion is honoured", theme.includes("prefers-reduced-motion"));
ok("there is one focus-visible ring for the whole system", theme.includes(":focus-visible"));
ok("a skip link exists for keyboard users", theme.includes(".ldg-skip"));
ok("display type is a weight of the one family, applied by a class", theme.includes(".ldg-display") && !/Fraunces|Georgia|Iowan/.test(FONTS.sans));
ok("section labels are sentence case, not stamps", theme.includes(".ldg-label") && !theme.includes("text-transform: uppercase"));
ok("nothing rises on its own but the arrival", !theme.includes("ldg-stagger"));
ok("there is no paper grain any more", !theme.includes("ldg-grain"));

// ---------- the primitives ----------
const primitives = readFileSync(new URL("../src/components/primitives.tsx", import.meta.url), "utf8");
ok("primitives are hook-free so they work as server components", !/\buse(State|Effect|Ref|Memo|Callback)\(/.test(primitives));
for (const name of ["Button", "LinkButton", "IconButton", "Card", "Label", "Display", "Badge", "SpeakerChip", "Avatar",
  "Input", "Select", "Textarea", "Field", "Toggle", "Segmented", "Spinner", "ProgressBar", "Notice", "EmptyState", "ErrorNote", "Rule", "Logo"]) {
  ok(`primitives export ${name}`, new RegExp(`export function ${name}\\b`).test(primitives));
}
ok("an icon button demands a label", /label: string/.test(primitives));
ok("the speaker mark is coloured by family index, not an inline hex", primitives.includes("ldg-speaker-${speakerIndex(label)}"));
ok("no primitive hardcodes a raw palette colour",
  !/\b(?:text|bg|border|ring|from|to)-(?:stone|emerald|amber|slate|gray|zinc|neutral|red|green|blue|indigo|teal|orange|yellow|lime|cyan|violet|purple|fuchsia|pink)-\d{2,3}\b/.test(primitives));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
