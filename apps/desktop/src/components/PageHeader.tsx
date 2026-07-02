import type { ReactNode } from "react";
import { Kicker } from "./ui.tsx";

/** Editorial page header: mono kicker · Fraunces display title · hairline rule. */
export function PageHeader({ kicker, title, subtitle, action }: {
  kicker?: string; title: string; subtitle?: string; action?: ReactNode;
}) {
  return (
    <header className="mb-8">
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          {kicker && <Kicker className="mb-2">{kicker}</Kicker>}
          <h1 className="pn-display text-[30px] leading-tight text-ink-text">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-muted">{subtitle}</p>}
        </div>
        {action && <div className="shrink-0 pb-1">{action}</div>}
      </div>
      <div className="mt-5 h-px bg-hairline" />
    </header>
  );
}

/** Standard page container — consistent max width + padding across screens. */
export function Page({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className={`mx-auto ${wide ? "max-w-6xl" : "max-w-5xl"} px-5 pb-24 pt-2 sm:px-8 md:pb-16`}>
      {children}
    </div>
  );
}
