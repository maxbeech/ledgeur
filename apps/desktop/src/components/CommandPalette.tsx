// ⌘K command palette: navigate, start recording, ask the brain, and jump to any
// meeting by title. Real data only — meeting entries come from the live cache.
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CircleDot, Sparkles, CalendarClock, CornerDownLeft } from "lucide-react";
import { cn, relativeTime } from "@parleynotes/ui";
import { NAV } from "./Sidebar.tsx";
import { useMeetings } from "../lib/useMeetings.ts";

interface Item { id: string; label: string; hint?: string; icon: React.ReactNode; run: () => void }

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNavigate();
  const { cards } = useMeetings();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) { setQ(""); setSel(0); setTimeout(() => inputRef.current?.focus(), 10); }
  }, [open]);

  const items = useMemo<Item[]>(() => {
    const go = (to: string) => () => { nav(to); onClose(); };
    const base: Item[] = [
      { id: "record", label: "Start recording", hint: "New meeting", icon: <CircleDot className="h-4 w-4 text-danger" />, run: go("/record") },
      ...NAV.map((n) => ({ id: n.to, label: `Go to ${n.label}`, icon: <n.icon className="h-4 w-4 text-muted" />, run: go(n.to) })),
    ];
    const meetings: Item[] = (cards ?? []).slice(0, 40).map((c) => ({
      id: `m-${c.id}`,
      label: c.title,
      hint: relativeTime(c.createdAt, new Date()),
      icon: <CalendarClock className="h-4 w-4 text-muted" />,
      run: () => { nav(`/meetings/${c.id}`); onClose(); },
    }));
    const all = [...base, ...meetings];
    const needle = q.trim().toLowerCase();
    const filtered = needle ? all.filter((i) => i.label.toLowerCase().includes(needle)) : all.slice(0, 9);
    // Free-text always gets an "ask the brain" escape hatch.
    if (needle) {
      filtered.push({
        id: "ask",
        label: `Ask the brain: “${q.trim()}”`,
        icon: <Sparkles className="h-4 w-4 text-glow" />,
        run: () => { nav(`/ask?q=${encodeURIComponent(q.trim())}`); onClose(); },
      });
    }
    return filtered;
  }, [q, cards, nav, onClose]);

  useEffect(() => { setSel((s) => Math.min(s, Math.max(0, items.length - 1))); }, [items.length]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
      else if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, items.length - 1)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
      else if (e.key === "Enter") { e.preventDefault(); items[sel]?.run(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, items, sel, onClose]);

  useEffect(() => {
    listRef.current?.children[sel]?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  if (!open) return null;

  return (
    <div className="pn-fade-in fixed inset-0 z-50 flex items-start justify-center bg-ink/35 px-4 pt-[14vh] backdrop-blur-[2px]" onMouseDown={onClose} role="dialog" aria-modal="true" aria-label="Quick actions">
      <div
        className="pn-palette-in w-full max-w-lg overflow-hidden rounded-2xl border border-hairline bg-surface shadow-[var(--shadow-palette)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          name="palette-search"
          value={q}
          onChange={(e) => { setQ(e.target.value); setSel(0); }}
          placeholder="Search meetings, or type a question…"
          className="w-full border-b border-hairline bg-transparent px-5 py-4 text-[15px] outline-none placeholder:text-faint"
          aria-label="Search"
        />
        <div ref={listRef} className="max-h-[46vh] overflow-y-auto p-2">
          {items.length === 0 && <div className="px-4 py-8 text-center text-sm text-muted">Nothing matches.</div>}
          {items.map((it, i) => (
            <button
              key={it.id}
              onClick={it.run}
              onMouseMove={() => setSel(i)}
              className={cn(
                "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm",
                i === sel ? "bg-surface-muted text-ink-text" : "text-ink-text/80",
              )}
            >
              {it.icon}
              <span className="min-w-0 flex-1 truncate">{it.label}</span>
              {it.hint && <span className="font-mono text-[10.5px] text-faint">{it.hint}</span>}
              {i === sel && <CornerDownLeft className="h-3.5 w-3.5 text-faint" />}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
