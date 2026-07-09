// The "window" frame every screen lives in — a card with a light chrome title
// bar, so each screen reads as an embedded window inside the app's chat surface
// (MainDraw-style) rather than a full-bleed page. The body owns its own scroll.
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export function ScreenEmbedCard({ title, icon: Icon, badge, children }: {
  title: string;
  icon: LucideIcon;
  badge?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="ldg-rise flex h-full w-full flex-col overflow-hidden rounded-2xl border border-hairline bg-surface shadow-[var(--shadow-card)]">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-hairline bg-surface-muted/40 px-3">
        <Icon className="h-3.5 w-3.5 text-muted" strokeWidth={2} />
        <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted">{title}</span>
        {badge && <span className="ml-auto">{badge}</span>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
