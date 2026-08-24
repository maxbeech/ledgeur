// The app's dark "furniture": spruce-ink rail with the wordmark, primary nav,
// a live-recording pill (recordings survive navigation) and the account footer.
import { NavLink, useNavigate } from "react-router-dom";
import { Landmark, House, CircleDot, Library, Sparkles, SquareCheck, Settings2, Command } from "lucide-react";
import { cn, formatElapsed } from "@ledgeur/ui";
import { hasBackend } from "../lib/config.ts";
import { useSession } from "../lib/session.ts";
import { useRecorderCtx } from "../lib/useRecorderCtx.ts";

export const NAV = [
  { to: "/", label: "Home", icon: House, end: true },
  { to: "/record", label: "Record", icon: CircleDot },
  { to: "/meetings", label: "Library", icon: Library },
  { to: "/ask", label: "Ask", icon: Sparkles },
  { to: "/tasks", label: "Tasks", icon: SquareCheck },
  { to: "/integrations", label: "Settings", icon: Settings2 },
];

export function Sidebar({ onOpenPalette }: { onOpenPalette: () => void }) {
  const nav = useNavigate();
  const { session } = useSession();
  const { state } = useRecorderCtx();
  const email = session?.user?.email ?? null;
  const connected = hasBackend && !!session;
  const recording = state.status === "recording";

  return (
    <aside className="hidden h-full w-[232px] shrink-0 flex-col bg-ink text-on-ink md:flex" aria-label="Primary">
      <div className="ldg-drag flex items-center gap-2.5 px-5 pb-5 pt-11">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/90 text-white">
          <Landmark className="h-[16px] w-[16px]" strokeWidth={2.1} />
        </div>
        <div className="leading-tight">
          <div className="ldg-display text-[17px] tracking-tight text-on-ink">Ledgeur</div>
          <div className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-on-ink-muted">Library of record</div>
        </div>
      </div>

      <nav className="flex-1 space-y-0.5 px-3 py-1">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium",
                "transition-colors duration-150",
                isActive ? "bg-white/10 text-white" : "text-on-ink-muted hover:bg-white/5 hover:text-on-ink",
              )
            }
          >
            {({ isActive }) => (
              <>
                <span className={cn("absolute left-0 top-1/2 h-4 w-[2.5px] -translate-y-1/2 rounded-full bg-glow transition-opacity", isActive ? "opacity-100" : "opacity-0")} />
                <Icon className="h-[17px] w-[17px]" strokeWidth={2} />
                {label}
                {to === "/record" && recording && (
                  <span className="ml-auto flex items-center gap-1.5 font-mono text-[10.5px] text-danger-on-ink">
                    <span className="ldg-pulse h-1.5 w-1.5 rounded-full bg-danger-on-ink" />
                    {formatElapsed(state.elapsed)}
                  </span>
                )}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {recording && (
        <button
          onClick={() => nav("/record")}
          className="mx-3 mb-2 flex items-center gap-2.5 rounded-xl border border-danger-on-ink/25 bg-danger-on-ink/10 px-3 py-2.5 text-left transition-colors hover:bg-danger-on-ink/15"
        >
          <span className="ldg-halo flex h-2.5 w-2.5 shrink-0 rounded-full bg-danger-on-ink" />
          <span className="min-w-0 leading-tight">
            <span className="block truncate text-[12.5px] font-medium text-on-ink">Recording</span>
            <span className="block font-mono text-[10.5px] text-on-ink-muted">{formatElapsed(state.elapsed)} · tap to return</span>
          </span>
        </button>
      )}

      <button
        onClick={onOpenPalette}
        className="mx-3 mb-2 flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-[12.5px] text-on-ink-muted transition-colors hover:bg-white/5 hover:text-on-ink"
      >
        <Command className="h-3.5 w-3.5" /> Quick actions
        <kbd className="ml-auto rounded-md border border-white/15 px-1.5 py-0.5 font-mono text-[10px]">⌘K</kbd>
      </button>

      <div className="border-t border-white/10 px-4 py-4">
        <NavLink to="/integrations" className="flex items-center gap-2.5 rounded-xl px-2 py-1.5 transition-colors hover:bg-white/5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent/70 to-glow/60 font-mono text-[11px] font-semibold uppercase text-white">
            {email ? email.slice(0, 2) : "PN"}
          </div>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-[12.5px] font-medium text-on-ink">{email ?? "Personal workspace"}</div>
            <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-on-ink-muted">
              <span className={cn("h-1.5 w-1.5 rounded-full", connected ? "bg-accent" : "bg-warn-on-ink/80")} />
              {connected ? "Synced" : hasBackend ? "Signed out" : "Local only"}
            </div>
          </div>
        </NavLink>
      </div>
    </aside>
  );
}
