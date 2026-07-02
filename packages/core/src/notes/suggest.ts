// Parsing for in-meeting "you could say" suggestions returned by the local
// model. Pure (unit-tested); the fetch lives in the app so this stays portable.

/** Pull suggestion strings out of a model reply — a JSON array when the model
 *  followed instructions, bulleted/numbered lines as a fallback. Throws when
 *  nothing usable came back (callers surface an explicit error, never filler). */
export function parseSuggestions(raw: string): string[] {
  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (jsonMatch) {
    try {
      const arr = JSON.parse(jsonMatch[0]) as unknown;
      if (Array.isArray(arr)) {
        const out = arr
          .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
          .map((s) => s.trim());
        if (out.length) return out.slice(0, 3);
      }
    } catch { /* fall through to line parsing */ }
  }
  const lines = raw
    .split("\n")
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter((l) => l.length > 8 && !/^json$/i.test(l));
  if (!lines.length) throw new Error("The model returned no usable suggestions.");
  return lines.slice(0, 3);
}
