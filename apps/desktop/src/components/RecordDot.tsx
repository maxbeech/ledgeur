// The recording mark: a peach dot, breathing while a take is live. One
// component, so the sidebar, the tab bar, the live room and the home screen
// all mean the same thing by it.
import { cn } from "@ledgeur/ui";

export function RecordDot({ live = false, className }: { live?: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-danger-fill",
        live && "ldg-halo",
        className,
      )}
    />
  );
}
