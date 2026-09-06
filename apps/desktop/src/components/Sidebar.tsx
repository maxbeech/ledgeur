// The sidebar: the wordmark, one button that starts a recording, the places in
// the app, your spaces, the last few meetings, and who you are. Light, quiet,
// and the same colour as the ground so the page is the thing that is white.
import { useSyncExternalStore } from "react";
import { NavLink, useNavigate, useSearchParams } from "react-router-dom";
import {
  House, Library, Sparkles, SquareCheck, Settings2, Command, Users, Plus, Download,
  type LucideIcon,
} from "lucide-react";
import { cn, formatElapsed, relativeTime } from "@ledgeur/ui";
import { Avatar, Badge, Logo, ProgressBar } from "@ledgeur/ui/components";
import { hasBackend } from "../lib/config.ts";
import { useSession } from "../lib/session.ts";
import { useRecorderCtx } from "../lib/useRecorderCtx.ts";
import { useMeetings } from "../lib/useMeetings.ts";
import { useFolders } from "../lib/folders.ts";
import { subscribeWarmup, getWarmupStatus } from "../lib/modelWarmup.ts";
import { RecordDot } from "./RecordDot.tsx";

export const NAV: readonly { to: string; label: string; icon: LucideIcon; end?: boolean }[] = [
  { to: "/", label: "Home", icon: House, end: true },
  { to: "/meetings", label: "Library", icon: Library },
  { to: "/ask", label: "Ask", icon: Sparkles },
  { to: "/tasks", label: "Tasks", icon: SquareCheck },
  { to: "/people", label: "People", icon: Users },
];

const itemClass = (active: boolean) => cn(
  "group flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-base font-medium transition-colors duration-150",
  active ? "bg-surface-sunken text-ink-text" : "text-muted hover:bg-surface-muted hover:text-ink-text",
);

export function Sidebar({ onOpenPalette }: { onOpenPalette: () => void }) {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const { session } = useSession();
  const { state } = useRecorderCtx();
  const { cards } = useMeetings();
  const folders = useFolders();
  const warmup = useSyncExternalStore(subscribeWarmup, getWarmupStatus);
  const email = session?.user?.email ?? null;
  const connected = hasBackend && !!session;
  const recording = state.status === "recording";
  const recent = (cards ?? []).slice(0, 6);
  const activeSpace = params.get("space");

  return (
    <aside className="flex h-full w-[264px] shrink-0 flex-col border-r border-hairline bg-paper" aria-label="Primary">
      <div className="ldg-drag flex items-center px-4 pb-3 pt-11" data-tauri-drag-region>
        <Logo size="sm" />
      </div>

      <div className="px-3 pb-2">
        <button
          onClick={() => nav("/record")}
          className={cn(
            "flex h-10 w-full items-center gap-2.5 rounded-lg px-3 text-base font-semibold transition-colors",
            recording ? "bg-danger-soft text-danger" : "bg-ink text-on-ink hover:bg-ink-soft",
          )}
        >
          <RecordDot live={recording} />
          {recording
            ? <>Recording <span className="ldg-num ml-auto text-sm font-medium opacity-80">{formatElapsed(state.elapsed)}</span></>
            : "New recording"}
        </button>
      </div>

      <nav className="space-y-0.5 px-3 py-2">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => itemClass(isActive && !activeSpace)}>
            <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {folders.length > 0 && (
          <section className="mb-4">
            <div className="flex items-center justify-between px-2.5 pb-1">
              <span className="text-xs font-semibold text-faint">Spaces</span>
              <button onClick={() => nav("/meetings?new=space")} className="rounded-md p-0.5 text-faint hover:text-ink-text" aria-label="New space">
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
            {folders.map((f) => (
              <NavLink key={f.id} to={`/meetings?space=${f.id}`} className={() => itemClass(activeSpace === f.id)}>
                <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", `bg-${f.tone}`)} />
                <span className="truncate">{f.name}</span>
              </NavLink>
            ))}
          </section>
        )}

        {recent.length > 0 && (
          <section>
            <div className="px-2.5 pb-1 text-xs font-semibold text-faint">Recent</div>
            {recent.map((m) => (
              <NavLink key={`${m.source}-${m.id}`} to={`/meetings/${m.id}`} className={({ isActive }) => cn(itemClass(isActive), "h-auto py-1.5")}>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{m.title}</span>
                  <span className="block truncate text-xs font-normal text-faint">{relativeTime(m.createdAt, new Date())}</span>
                </span>
              </NavLink>
            ))}
          </section>
        )}
      </div>

      {warmup.phase === "downloading" && (
        <div className="mx-3 mb-2 rounded-lg bg-surface-muted px-3 py-2.5">
          <div className="flex items-center gap-2 text-xs font-medium text-muted">
            <Download className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{warmup.label || "Preparing the speech model"}</span>
            {warmup.progress != null && <span className="ldg-num">{Math.round(warmup.progress)}%</span>}
          </div>
          <ProgressBar value={warmup.progress} className="mt-2" />
        </div>
      )}

      <div className="space-y-0.5 border-t border-hairline p-3">
        <button onClick={onOpenPalette} className={cn(itemClass(false), "w-full")}>
          <Command className="h-[18px] w-[18px]" strokeWidth={2} />
          Quick actions
          <kbd className="ml-auto rounded-md border border-hairline-strong px-1.5 text-2xs font-medium text-faint">⌘K</kbd>
        </button>
        <NavLink to="/integrations" className={({ isActive }) => itemClass(isActive)}>
          <Settings2 className="h-[18px] w-[18px]" strokeWidth={2} />
          Settings
        </NavLink>
        <NavLink to="/integrations" className="mt-1 flex items-center gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-surface-muted">
          <Avatar name={email ?? "Personal"} size="sm" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-ink-text">{email ?? "Personal workspace"}</span>
          </span>
          <Badge tone={connected ? "accent" : "neutral"}>{connected ? "Synced" : hasBackend ? "Signed out" : "Local"}</Badge>
        </NavLink>
      </div>
    </aside>
  );
}
