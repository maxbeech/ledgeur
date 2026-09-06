// The phone's bottom tabs. Five, evenly spaced, icon over label, sitting
// above the home indicator. Record is the middle one and carries the
// recording dot while a take is live.
import { NavLink } from "react-router-dom";
import { House, Library, Mic, Sparkles, Settings2 } from "lucide-react";
import { cn } from "@ledgeur/ui";
import { useRecorderCtx } from "../lib/useRecorderCtx.ts";
import { RecordDot } from "./RecordDot.tsx";

const TABS = [
  { to: "/", label: "Home", icon: House, end: true },
  { to: "/meetings", label: "Library", icon: Library },
  { to: "/record", label: "Record", icon: Mic },
  { to: "/ask", label: "Ask", icon: Sparkles },
  { to: "/integrations", label: "Settings", icon: Settings2 },
] as const;

export function MobileTabBar() {
  const { state } = useRecorderCtx();
  const recording = state.status === "recording";

  return (
    <nav
      aria-label="Tabs"
      className="ldg-safe-bottom flex shrink-0 items-stretch justify-around border-t border-hairline bg-surface px-1 pt-1.5"
    >
      {TABS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={"end" in item ? item.end : false}
          className={({ isActive }) =>
            cn(
              "relative flex w-16 flex-col items-center gap-1 rounded-lg pb-2 pt-1 text-2xs font-semibold transition-colors",
              isActive ? "text-ink-text" : "text-faint active:text-muted",
            )
          }
        >
          {({ isActive }) => (
            <>
              <span className={cn("flex h-7 w-11 items-center justify-center rounded-full transition-colors", isActive && "bg-surface-sunken")}>
                <item.icon className="h-[20px] w-[20px]" strokeWidth={2} />
              </span>
              {item.label}
              {item.to === "/record" && recording && <RecordDot live className="absolute right-3 top-1 h-2 w-2" />}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
