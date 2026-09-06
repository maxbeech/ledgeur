// Recipes — the user's own note templates.
//
// The six built-ins cover most meetings and none of anybody's actual job. A
// team that runs the same call every week (a customer QBR, a design critique, a
// support triage) knows what its notes should look for, and only they know it.
// A recipe is the same NoteTemplate shape written by the user, so it flows
// through the identical prompt path — there is no second summariser and no
// second storage format to keep in step.
//
// Kept on the device, and synced to the account when there is one: a recipe
// describes how somebody works, and it should follow them to their phone.
// Every edit is stamped; a deleted recipe leaves a tombstone until the engine
// has told the cloud (see sync.ts).

import { useSyncExternalStore } from "react";
import {
  newTemplateId, resolveTemplate, allTemplates, validateTemplate, toTemplate,
  type NoteTemplate,
} from "@ledgeur/core";

const KEY = "ledgeur.recipes";

/** A recipe as stored: the template plus the stamps sync needs. */
export interface RecipeRecord extends NoteTemplate {
  updatedAt: string;
  deletedAt?: string;
}

function load(): RecipeRecord[] {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (!Array.isArray(parsed)) return [];
    // Defensive: a hand-edited or half-written store must not break the picker
    // (and with it, recording) — drop anything that isn't a usable template.
    return parsed
      .filter((t): t is NoteTemplate & Partial<RecipeRecord> =>
        Boolean(t) && typeof t === "object"
        && typeof (t as NoteTemplate).id === "string"
        && typeof (t as NoteTemplate).name === "string"
        && Array.isArray((t as NoteTemplate).looksFor))
      // Records from before stamps existed count as edited at the epoch, so a
      // stamped copy from another device wins over them.
      .map((t) => ({ ...t, updatedAt: t.updatedAt ?? "1970-01-01T00:00:00.000Z" }));
  } catch {
    return [];
  }
}

let records: RecipeRecord[] = load();
let live: NoteTemplate[] = records.filter((r) => !r.deletedAt);
const listeners = new Set<() => void>();

function commit(next: RecipeRecord[]) {
  records = next;
  live = records.filter((r) => !r.deletedAt);
  try {
    localStorage.setItem(KEY, JSON.stringify(records));
  } catch {
    /* storage unavailable (private mode) — keep the in-memory value */
  }
  for (const l of listeners) l();
}

export function getRecipes(): NoteTemplate[] {
  return live;
}

/** Everything, tombstones included — the engine's view. */
export function getRecipeRecords(): RecipeRecord[] {
  return records;
}

/** Write what the cloud has, without stamping: it is not a new edit. */
export function applyRemoteRecipes(pulled: readonly RecipeRecord[], removed: readonly string[]): void {
  const byId = new Map(records.map((r) => [r.id, r]));
  for (const r of pulled) byId.set(r.id, r);
  for (const id of removed) byId.delete(id);
  commit([...byId.values()]);
}

/** A tombstone the cloud has acknowledged can go. */
export function forgetRecipes(ids: readonly string[]): void {
  if (ids.length === 0) return;
  commit(records.filter((r) => !ids.includes(r.id)));
}

/** Create or update a recipe from a draft. Throws with the validation reasons
 *  so a caller cannot save something that would silently do nothing. */
export function saveRecipe(draft: Partial<NoteTemplate> & { name: string }): NoteTemplate {
  const errors = validateTemplate(draft);
  if (errors.length) throw new Error(errors.join(" "));
  const existing = live.map((t) => t.id);
  const id = draft.id && existing.includes(draft.id) ? draft.id : newTemplateId(draft.name, existing);
  const template = toTemplate({ ...draft, id, name: draft.name });
  const record: RecipeRecord = { ...template, updatedAt: new Date().toISOString() };
  commit(records.some((r) => r.id === id) ? records.map((r) => (r.id === id ? record : r)) : [...records, record]);
  return template;
}

export function deleteRecipe(id: string): void {
  const now = new Date().toISOString();
  commit(records.map((r) => (r.id === id ? { ...r, deletedAt: now, updatedAt: now } : r)));
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useRecipes(): NoteTemplate[] {
  return useSyncExternalStore(subscribe, getRecipes, getRecipes);
}

/** Everything pickable right now — built-ins plus this account's recipes. */
export function usePickableTemplates(): NoteTemplate[] {
  return allTemplates(useRecipes());
}

/** Resolve a template id against the built-ins and the recipes. The single
 *  entry point for note generation, so a recipe reaches the prompt exactly the
 *  way a built-in does. */
export function templateFor(id: string | undefined | null): NoteTemplate {
  return resolveTemplate(id, live);
}
