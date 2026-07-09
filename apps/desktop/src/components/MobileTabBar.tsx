// Bottom tab bar for phone-sized windows (iOS/Android shells). The Record tab
// sits centre in a raised circle; while recording it pulses with the elapsed time.
import { NavLink } from "react-router-dom";
import { House, CircleDot, Library, Sparkles, Settings2 } from "lucide-react";
import { cn, formatElapsed } from "@ledgeur/ui";
import { useRecorderCtx } from "../lib/useRecorderCtx.ts";

const SIDE = [
  { to: "/", label: "Home", icon: House, end: true },
  { to: "/meetings", label: "Library", icon: Library },
  null, // centre slot: Record
  { to: "/ask", label: "Ask", icon: Sparkles },
  { to: "/integrations", label: "Settings", icon: Settings2 },
] as const;

export function MobileTabBar() {
  const { state } = useRecorderCtx();
  const recording = state.status === "recording";

  return (
    <nav
      aria-label="Mobile"
      className="fixed inset-x-0 bottom-0 z-40 flex items-end justify-around border-t border-hairline bg-surface/95 px-2 pb-[max(env(safe-area-inset-bottom),8px)] pt-2 backdrop-blur md:hidden"
    >
      {SIDE.map((item) =>
        item ? (
          <NavLink
            key={item.to}
            to={item.to}
            end={"end" in item ? item.end : false}
            className={({ isActive }) =>
              cn(
                "flex w-16 flex-col items-center gap-0.5 rounded-lg py-1 text-[10px] font-medium transition-colors",
                isActive ? "text-ink" : "text-faint hover:text-muted",
              )
            }
          >
            <item.icon className="h-[19px] w-[19px]" strokeWidth={2} />
            {item.label}
          </NavLink>
        ) : (
          <NavLink
            key="record"
            to="/record"
            aria-label="Record"
            className="relative -top-3 flex h-14 w-14 flex-col items-center justify-center rounded-full bg-ink text-on-ink shadow-[var(--shadow-float)] transition-transform active:scale-95"
          >
            {recording ? (
              <>
                <span className="ldg-pulse h-2.5 w-2.5 rounded-full bg-red-400" />
                <span className="mt-0.5 font-mono text-[9px] text-on-ink-muted">{formatElapsed(state.elapsed)}</span>
              </>
            ) : (
              <CircleDot className="h-6 w-6 text-red-300" strokeWidth={2} />
            )}
          </NavLink>
        ),
      )}
    </nav>
  );
}
