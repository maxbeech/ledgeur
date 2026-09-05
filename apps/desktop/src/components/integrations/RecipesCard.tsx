// Recipes — writing your own note style.
//
// The editor is deliberately two fields, not a schema builder. What a template
// can do is steer emphasis (see core notes/templates.ts); pretending otherwise
// with a section designer would promise notes in a shape the rest of the app
// cannot store, render, export or search.

import { useState } from "react";
import { ChefHat, Plus, Trash2, X } from "lucide-react";
import { NOTE_TEMPLATES, type NoteTemplate } from "@ledgeur/core";
import { Button, Card, Chip, ErrorNote, Kicker } from "../ui.tsx";
import { useRecipes, saveRecipe, deleteRecipe } from "../../lib/recipes.ts";

export function RecipesCard() {
  const recipes = useRecipes();
  const [editing, setEditing] = useState<Partial<NoteTemplate> | null>(null);
  const [error, setError] = useState("");

  function save() {
    if (!editing?.name) { setError("Give it a name."); return; }
    try {
      saveRecipe({ ...editing, name: editing.name });
      setEditing(null);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Card className="p-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-2">
            <ChefHat className="h-4 w-4 text-accent-strong" />
            <Kicker>Recipes</Kicker>
          </div>
          <p className="text-xs leading-relaxed text-muted">
            Your own note styles, on top of the {NOTE_TEMPLATES.length} built-in ones. A recipe tells the
            summariser what this kind of meeting is for and what to look out for; the notes still come back
            as summary, decisions, action items and open questions, so everything else in the app keeps
            working with them.
          </p>
        </div>
        {!editing && (
          <Button size="sm" variant="outline" onClick={() => { setEditing({ name: "", focus: "", looksFor: [""] }); setError(""); }}>
            <Plus className="h-4 w-4" /> New recipe
          </Button>
        )}
      </div>

      {recipes.length > 0 && (
        <ul className="mb-4 divide-y divide-hairline rounded-xl border border-hairline">
          {recipes.map((r) => (
            <li key={r.id} className="flex items-start gap-3 px-3.5 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[13.5px] font-medium text-ink-text">{r.name}</span>
                  <Chip>{r.looksFor.length} cue{r.looksFor.length === 1 ? "" : "s"}</Chip>
                </div>
                {r.focus && <p className="mt-0.5 truncate text-[11.5px] text-muted">{r.focus}</p>}
              </div>
              <button
                onClick={() => setEditing({ ...r })}
                className="shrink-0 text-[11px] font-semibold text-muted underline hover:text-ink-text"
              >
                Edit
              </button>
              <button
                onClick={() => deleteRecipe(r.id)}
                aria-label={`Delete the recipe ${r.name}`}
                className="shrink-0 text-faint transition-colors hover:text-danger"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <div className="rounded-xl border border-hairline bg-surface-muted/40 p-4">
          <div className="mb-3 flex items-center justify-between">
            <Kicker>{editing.id ? "Edit recipe" : "New recipe"}</Kicker>
            <button onClick={() => { setEditing(null); setError(""); }} aria-label="Cancel"><X className="h-4 w-4 text-faint hover:text-ink-text" /></button>
          </div>

          <label htmlFor="rc-name" className="ldg-kicker mb-1.5 block">Name</label>
          <input
            id="rc-name"
            value={editing.name ?? ""}
            onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            placeholder="Customer QBR"
            className="mb-3 w-full rounded-lg border border-hairline bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent/40"
          />

          <label htmlFor="rc-focus" className="ldg-kicker mb-1.5 block">What is this kind of meeting for?</label>
          <textarea
            id="rc-focus"
            value={editing.focus ?? ""}
            onChange={(e) => setEditing({ ...editing, focus: e.target.value })}
            rows={2}
            placeholder="This is a quarterly review with an existing customer about how they are getting on."
            className="mb-3 w-full resize-y rounded-lg border border-hairline bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent/40"
          />

          <Kicker className="mb-1.5">Things to look for, most important first</Kicker>
          <div className="mb-2 space-y-2">
            {(editing.looksFor ?? [""]).map((cue, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  value={cue}
                  onChange={(e) => {
                    const next = [...(editing.looksFor ?? [])];
                    next[i] = e.target.value;
                    setEditing({ ...editing, looksFor: next });
                  }}
                  placeholder={i === 0 ? "anything they said is not working for them" : "another cue"}
                  aria-label={`Cue ${i + 1}`}
                  className="min-w-0 flex-1 rounded-lg border border-hairline bg-surface px-3 py-1.5 text-[13px] outline-none focus:ring-2 focus:ring-accent/40"
                />
                <button
                  onClick={() => setEditing({ ...editing, looksFor: (editing.looksFor ?? []).filter((_, j) => j !== i) })}
                  aria-label={`Remove cue ${i + 1}`}
                  className="shrink-0 text-faint transition-colors hover:text-danger"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
          <button
            onClick={() => setEditing({ ...editing, looksFor: [...(editing.looksFor ?? []), ""] })}
            className="mb-4 inline-flex items-center gap-1 text-[11.5px] font-semibold text-muted underline hover:text-ink-text"
          >
            <Plus className="h-3 w-3" /> Add another
          </button>

          {error && <ErrorNote className="mb-3">{error}</ErrorNote>}
          <div className="flex gap-2">
            <Button size="sm" variant="accent" onClick={save}>Save recipe</Button>
            <Button size="sm" variant="ghost" onClick={() => { setEditing(null); setError(""); }}>Cancel</Button>
          </div>
        </div>
      )}

      {!editing && recipes.length === 0 && (
        <p className="text-[11.5px] leading-relaxed text-faint">
          Nothing yet. A recipe is worth writing once you notice you keep wanting the same thing out of
          the same kind of call — it takes a minute and applies to every one after it.
        </p>
      )}
    </Card>
  );
}
