// The phone's bottom tabs. Five, evenly spaced, icon over label, sitting
// above the home indicator.
//
// The two ways into the product — record a meeting, keep a thought — are the
// middle two, next to each other and both one tap. Record carries the recording
// dot while a take is live.
//
// Keep is a button rather than a link: the capture box opens over whatever
// screen you are on, so a thought caught halfway through reading a transcript
// does not cost you your place. The list of kept thoughts is on Home and one
// tap from the confirmation; the box is the thing that has to be instant.
//
// Ask has no tab on a phone and does not need one — the composer at the bottom
// of every screen *is* Ask, and it is already always visible.
import { NavLink } from "react-router-dom";
import { House, Library, Mic, Plus, Settings2, type LucideIcon } from "lucide-react";
import { cn } from "@ledgeur/ui";
import { useRecorderCtx } from "../lib/useRecorderCtx.ts";
import { openCapture } from "../lib/captureDock.ts";
import { RecordDot } from "./RecordDot.tsx";

interface LinkTab { kind: "link"; to: string; label: string; icon: LucideIcon; end?: boolean }
interface ActionTab { kind: "action"; label: string; icon: LucideIcon; run: () => void }

const TABS: readonly (LinkTab | ActionTab)[] = [
  { kind: "link", to: "/", label: "Home", icon: House, end: true },
  { kind: "link", to: "/meetings", label: "Library", icon: Library },
  { kind: "link", to: "/record", label: "Record", icon: Mic },
  { kind: "action", label: "Keep", icon: Plus, run: () => openCapture("type") },
  { kind: "link", to: "/integrations", label: "Settings", icon: Settings2 },
];

const tabClass = (active: boolean) => cn(
  "relative flex w-16 flex-col items-center gap-1 rounded-lg pb-2 pt-1 text-2xs font-semibold transition-colors",
  active ? "text-ink-text" : "text-faint active:text-muted",
);

const iconClass = (active: boolean) =>
  cn("flex h-7 w-11 items-center justify-center rounded-full transition-colors", active && "bg-surface-sunken");

export function MobileTabBar() {
  const { state } = useRecorderCtx();
  const recording = state.status === "recording";

  return (
    <nav
      aria-label="Tabs"
      className="ldg-safe-bottom flex shrink-0 items-stretch justify-around border-t border-hairline bg-surface px-1 pt-1.5"
    >
      {TABS.map((item) =>
        item.kind === "action" ? (
          <button key={item.label} onClick={item.run} className={tabClass(false)}>
            <span className={cn(iconClass(false), "bg-ink text-on-ink")}>
              <item.icon className="h-[20px] w-[20px]" strokeWidth={2.5} />
            </span>
            {item.label}
          </button>
        ) : (
          <NavLink key={item.to} to={item.to} end={item.end ?? false} className={({ isActive }) => tabClass(isActive)}>
            {({ isActive }) => (
              <>
                <span className={iconClass(isActive)}>
                  <item.icon className="h-[20px] w-[20px]" strokeWidth={2} />
                </span>
                {item.label}
                {item.to === "/record" && recording && <RecordDot live className="absolute right-3 top-1 h-2 w-2" />}
              </>
            )}
          </NavLink>
        ),
      )}
    </nav>
  );
}
