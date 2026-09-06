// Generates src/tokens.css from src/tokens.ts.
//
// Run: pnpm --filter @ledgeur/ui build:theme
//
// The CSS has to exist as a file (Tailwind reads it), and the values have to
// exist in TypeScript (the social image, canvas visualisers and native chrome
// read them). Generating one from the other is the only way they stay equal —
// the test suite regenerates in memory and fails if the committed file differs.

import { writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { LIGHT, DARK, flatten, FONTS, TYPE_SCALE, RADII, SHADOWS, MOTION } from "./src/tokens.ts";

export function renderThemeCss(): string {
  const light = flatten(LIGHT);
  const dark = flatten(DARK);
  const vars = (p: Record<string, string>, indent: string) =>
    Object.entries(p).map(([k, v]) => `${indent}--ldg-${k}: ${v};`).join("\n");

  const lines: string[] = [];
  lines.push("/* GENERATED from src/tokens.ts by build-theme.mts — do not edit by hand. */");
  lines.push("");
  lines.push(":root {");
  lines.push("  color-scheme: light;");
  lines.push(vars(light, "  "));
  lines.push("}");
  lines.push("");
  lines.push("/* Dark follows the system unless the page has chosen. */");
  lines.push("@media (prefers-color-scheme: dark) {");
  lines.push('  :root:not([data-theme="light"]) {');
  lines.push("    color-scheme: dark;");
  lines.push(vars(dark, "    "));
  lines.push("  }");
  lines.push("}");
  lines.push('[data-theme="dark"] {');
  lines.push("  color-scheme: dark;");
  lines.push(vars(dark, "  "));
  lines.push("}");
  lines.push("");
  lines.push("/* Tailwind reads the tokens from here. `inline` makes every utility point at");
  lines.push("   the runtime variable, which is what lets the same class change with the mode. */");
  lines.push("@theme inline {");
  lines.push(Object.keys(light).map((k) => `  --color-${k}: var(--ldg-${k});`).join("\n"));
  lines.push("");
  lines.push(`  --font-sans: ${FONTS.sans};`);
  lines.push(`  --font-mono: ${FONTS.mono};`);
  lines.push("");
  for (const [k, px] of Object.entries(TYPE_SCALE)) {
    lines.push(`  --text-${k}: ${px}px;`);
  }
  lines.push("");
  for (const [k, v] of Object.entries(RADII)) {
    lines.push(`  --radius-${k}: ${v};`);
  }
  lines.push("");
  for (const [k, v] of Object.entries(SHADOWS)) {
    lines.push(`  --shadow-${k}: ${v};`);
  }
  lines.push("");
  lines.push(`  --ease-settle: ${MOTION.settle};`);
  lines.push(`  --ease-swift: ${MOTION.swift};`);
  lines.push("}");
  lines.push("");
  return lines.join("\n");
}

const HERE = dirname(fileURLToPath(import.meta.url));
export const TOKENS_CSS_PATH = join(HERE, "src", "tokens.css");

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const next = renderThemeCss();
  let current = "";
  try { current = readFileSync(TOKENS_CSS_PATH, "utf8"); } catch { /* first run */ }
  if (current !== next) {
    writeFileSync(TOKENS_CSS_PATH, next);
    console.log(`wrote ${TOKENS_CSS_PATH}`);
  } else {
    console.log("tokens.css is up to date");
  }
}
