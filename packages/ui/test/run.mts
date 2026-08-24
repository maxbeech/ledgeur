// @ledgeur/ui test suite — the design system's own guardrails.
//
// Two things are asserted here that no amount of care would otherwise keep
// true:
//
//  1. tokens.ts and theme.css describe the SAME palette. They must both exist
//     (TypeScript reads one, CSS reads the other) and they drift silently —
//     a colour changed in one place looks fine until a canvas visualiser and
//     the page around it disagree.
//  2. Every colour meant for text clears WCAG AA. The previous palette shipped
//     a `faint` at 2.86:1, which is unreadable and was never noticed because
//     nobody re-measured after picking it.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { COLORS, FONTS, SPEAKER_COLORS, speakerColor, confidenceTier, RADII, MOTION } from "../src/tokens.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(HERE, "../src/theme.css"), "utf8");

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.error(`  FAIL ${name} ${detail}`); }
};

/** The value of an `@theme` custom property. */
function cssVar(name: string): string | null {
  const m = new RegExp(`--${name}:\\s*([^;]+);`).exec(css);
  return m ? m[1].trim() : null;
}

// ---------- tokens.ts and theme.css agree ----------
// Each TS token paired with the CSS custom property that must match it.
const MIRRORED: [keyof typeof COLORS, string][] = [
  ["paper", "color-paper"],
  ["surface", "color-surface"],
  ["surfaceMuted", "color-surface-muted"],
  ["surfaceSunken", "color-surface-sunken"],
  ["ink", "color-ink"],
  ["inkSoft", "color-ink-soft"],
  ["inkRaised", "color-ink-raised"],
  ["accent", "color-accent"],
  ["accentStrong", "color-accent-strong"],
  ["accentSoft", "color-accent-soft"],
  ["glow", "color-glow"],
  ["glowStrong", "color-glow-strong"],
  ["glowSoft", "color-glow-soft"],
  ["danger", "color-danger"],
  ["dangerSoft", "color-danger-soft"],
  ["dangerOnInk", "color-danger-on-ink"],
  ["warn", "color-warn"],
  ["warnSoft", "color-warn-soft"],
  ["warnOnInk", "color-warn-on-ink"],
  ["text", "color-ink-text"],
  ["textMuted", "color-muted"],
  ["textFaint", "color-faint"],
  ["textOnInk", "color-on-ink"],
  ["textOnInkMuted", "color-on-ink-muted"],
  ["border", "color-hairline"],
  ["borderStrong", "color-hairline-strong"],
];

for (const [token, variable] of MIRRORED) {
  ok(`${token} matches --${variable}`,
    COLORS[token].toLowerCase() === (cssVar(variable) ?? "").toLowerCase(),
    `ts=${COLORS[token]} css=${cssVar(variable)}`);
}
ok("every colour token is mirrored in CSS", MIRRORED.length === Object.keys(COLORS).length,
  `${MIRRORED.length} mirrored vs ${Object.keys(COLORS).length} tokens — add the new one to this test`);

for (const [key, variable] of [["display", "font-display"], ["sans", "font-sans"], ["mono", "font-mono"]] as const) {
  ok(`font ${key} matches --${variable}`, FONTS[key] === cssVar(variable), `ts=${FONTS[key]} css=${cssVar(variable)}`);
}
ok("the settle easing matches", MOTION.settle === cssVar("ease-settle"));
ok("the swift easing matches", MOTION.swift === cssVar("ease-swift"));
ok("the xl radius matches", RADII.xl === cssVar("radius-xl"));

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

// Text colours, on both surfaces they are ever placed on.
for (const token of ["text", "textMuted", "textFaint"] as const) {
  for (const bg of ["paper", "surface", "surfaceMuted", "surfaceSunken"] as const) {
    ok(`${token} on ${bg} clears AA`, contrast(COLORS[token], COLORS[bg]) >= AA,
      `${contrast(COLORS[token], COLORS[bg]).toFixed(2)}:1`);
  }
}
// The dark chrome needs its own danger and warn tones: the paper ones are
// 2.55:1 and 2.2:1 on ink, which is why the sidebar was using raw Tailwind reds.
for (const token of ["textOnInk", "textOnInkMuted", "dangerOnInk", "warnOnInk"] as const) {
  for (const bg of ["ink", "inkSoft", "inkRaised"] as const) {
    ok(`${token} on ${bg} clears AA`, contrast(COLORS[token], COLORS[bg]) >= AA,
      `${contrast(COLORS[token], COLORS[bg]).toFixed(2)}:1`);
  }
}

// The "strong" variants exist precisely so coloured text has a legal option.
for (const token of ["accentStrong", "glowStrong", "danger", "warn"] as const) {
  ok(`${token} is legible as text on paper`, contrast(COLORS[token], COLORS.paper) >= AA,
    `${contrast(COLORS[token], COLORS.paper).toFixed(2)}:1`);
}
// White on a filled button.
ok("white text on the primary button clears AA", contrast("#ffffff", COLORS.accentStrong) >= AA,
  `${contrast("#ffffff", COLORS.accentStrong).toFixed(2)}:1`);
ok("white text on a destructive button clears AA", contrast("#ffffff", COLORS.danger) >= AA,
  `${contrast("#ffffff", COLORS.danger).toFixed(2)}:1`);

// Soft tints are backgrounds for their strong sibling — that pairing must read.
for (const [fg, bg] of [["accentStrong", "accentSoft"], ["glowStrong", "glowSoft"], ["danger", "dangerSoft"], ["warn", "warnSoft"]] as const) {
  ok(`${fg} on ${bg} clears AA`, contrast(COLORS[fg], COLORS[bg]) >= AA,
    `${contrast(COLORS[fg], COLORS[bg]).toFixed(2)}:1`);
}

// ---------- speaker colours ----------
for (const c of SPEAKER_COLORS) {
  ok(`speaker colour ${c.name} is legible on its own tint`, contrast(c.fg, c.bg) >= AA,
    `${contrast(c.fg, c.bg).toFixed(2)}:1`);
}
ok("speaker colours are distinct", new Set(SPEAKER_COLORS.map((c) => c.fg)).size === SPEAKER_COLORS.length);
ok("Speaker 1 is the first colour", speakerColor("Speaker 1").name === SPEAKER_COLORS[0].name);
ok("Speaker 2 differs from Speaker 1", speakerColor("Speaker 2").name !== speakerColor("Speaker 1").name);
ok("speaker colours cycle past the palette length",
  speakerColor(`Speaker ${SPEAKER_COLORS.length + 1}`).name === SPEAKER_COLORS[0].name);
ok("a named speaker gets a stable colour", speakerColor("Priya").name === speakerColor("Priya").name);
ok("a named speaker still gets a real colour",
  SPEAKER_COLORS.some((c) => c.name === speakerColor("Priya").name));
ok("an empty label does not crash", typeof speakerColor("").name === "string");

// ---------- confidence tiers ----------
ok("high confidence is high", confidenceTier(0.9) === "high");
ok("the AA of confidence, 0.8, is high", confidenceTier(0.8) === "high");
ok("middling confidence is medium", confidenceTier(0.6) === "medium");
ok("low confidence is low", confidenceTier(0.2) === "low");
ok("no confidence is unknown", confidenceTier(null) === "unknown" && confidenceTier(undefined) === "unknown");

// ---------- the stylesheet's own promises ----------
ok("reduced motion is honoured", css.includes("prefers-reduced-motion"));
ok("there is one focus-visible ring for the whole system", css.includes(":focus-visible"));
ok("a skip link exists for keyboard users", css.includes(".ldg-skip"));
ok("the display face is applied by a class, not ad hoc", css.includes(".ldg-display"));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
