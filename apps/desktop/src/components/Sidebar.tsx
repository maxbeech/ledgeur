import { NavLink } from "react-router-dom";
import { Brain, CalendarClock, CircleDot, Sparkles, CheckSquare, Plug, Building2 } from "lucide-react";
import { cn } from "@parleynotes/ui";
import { hasBackend } from "../lib/config.ts";
import { useSession } from "../lib/session.ts";

const NAV = [
  { to: "/", label: "Brain", icon: Brain, end: true },
  { to: "/record", label: "Record", icon: CircleDot },
  { to: "/meetings", label: "Meetings", icon: CalendarClock },
  { to: "/ask", label: "Ask", icon: Sparkles },
  { to: "/tasks", label: "Tasks", icon: CheckSquare },
  { to: "/integrations", label: "Integrations", icon: Plug },
];

export function Sidebar() {
  const { session } = useSession();
  const email = session?.user?.email ?? null;
  const connected = hasBackend && !!session;
  return (
    <aside className="flex h-full w-[236px] shrink-0 flex-col bg-ink text-on-ink">
      <div className="pn-drag flex items-center gap-2.5 px-5 pb-4 pt-11">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-accent text-white shadow-inner">
          <Brain className="h-[18px] w-[18px]" strokeWidth={2.2} />
        </div>
        <div className="leading-tight">
          <div className="text-[15px] font-semibold tracking-tight">ParleyNotes</div>
          <div className="text-[11px] text-on-ink-muted">Company brain</div>
        </div>
      </div>

      <nav className="flex-1 space-y-0.5 px-3 py-2">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                isActive ? "bg-white/12 text-white" : "text-on-ink-muted hover:bg-white/6 hover:text-on-ink",
              )
            }
          >
            <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-white/10 px-4 py-4">
        <div className="flex items-center gap-2.5 rounded-xl px-2 py-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10">
            <Building2 className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-[13px] font-medium text-on-ink">{email ?? "Personal workspace"}</div>
            <div className="flex items-center gap-1.5 text-[11px] text-on-ink-muted">
              <span className={cn("h-1.5 w-1.5 rounded-full", connected ? "bg-accent" : "bg-amber-400")} />
              {connected ? "Synced" : hasBackend ? "Signed out" : "Local only"}
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
