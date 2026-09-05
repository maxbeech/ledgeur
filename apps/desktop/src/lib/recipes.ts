// Recipes — the user's own note templates.
//
// The six built-ins cover most meetings and none of anybody's actual job. A
// team that runs the same call every week (a customer QBR, a design critique, a
// support triage) knows what its notes should look for, and only they know it.
// A recipe is the same NoteTemplate shape written by the user, so it flows
// through the identical prompt path — there is no second summariser and no
// second storage format to keep in step.
//
// Kept on the device, like the meetings themselves: a recipe describes how
// somebody works, and nothing here needs an account to be useful.

import { useSyncExternalStore } from "react";
import {
  newTemplateId, resolveTemplate, allTemplates, validateTemplate, toTemplate,
  type NoteTemplate,
} from "@ledgeur/core";

const KEY = "ledgeur.recipes";

function load(): NoteTemplate[] {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (!Array.isArray(parsed)) return [];
    // Defensive: a hand-edited or half-written store must not break the picker
    // (and with it, recording) — drop anything that isn't a usable template.
    return parsed.filter((t): t is NoteTemplate =>
      Boolean(t) && typeof t === "object"
      && typeof (t as NoteTemplate).id === "string"
      && typeof (t as NoteTemplate).name === "string"
      && Array.isArray((t as NoteTemplate).looksFor));
  } catch {
    return [];
  }
}

let current: NoteTemplate[] = load();
const listeners = new Set<() => void>();

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* storage unavailable (private mode) — keep the in-memory value */
  }
  for (const l of listeners) l();
}

export function getRecipes(): NoteTemplate[] {
  return current;
}

/** Create a recipe from a draft. Throws with the validation reasons so a
 *  caller cannot save something that would silently do nothing. */
export function saveRecipe(draft: Partial<NoteTemplate> & { name: string }): NoteTemplate {
  const errors = validateTemplate(draft);
  if (errors.length) throw new Error(errors.join(" "));
  const existing = current.map((t) => t.id);
  const id = draft.id && existing.includes(draft.id) ? draft.id : newTemplateId(draft.name, existing);
  const template = toTemplate({ ...draft, id, name: draft.name });
  current = existing.includes(id)
    ? current.map((t) => (t.id === id ? template : t))
    : [...current, template];
  persist();
  return template;
}

export function deleteRecipe(id: string): void {
  current = current.filter((t) => t.id !== id);
  persist();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useRecipes(): NoteTemplate[] {
  return useSyncExternalStore(subscribe, getRecipes, getRecipes);
}

/** Everything pickable right now — built-ins plus this device's recipes. */
export function usePickableTemplates(): NoteTemplate[] {
  return allTemplates(useRecipes());
}

/** Resolve a template id against the built-ins and this device's recipes.
 *  The single entry point for note generation, so a recipe reaches the prompt
 *  exactly the way a built-in does. */
export function templateFor(id: string | undefined | null): NoteTemplate {
  return resolveTemplate(id, current);
}
