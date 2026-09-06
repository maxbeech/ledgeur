// A screen's title and the one action that belongs beside it.
import type { ReactNode } from "react";
import { cn } from "@ledgeur/ui";

export function PageHeader({ title, subtitle, action, back }: {
  title: string; subtitle?: ReactNode; action?: ReactNode; back?: ReactNode;
}) {
  return (
    <header className="mb-6">
      {back && <div className="mb-3">{back}</div>}
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="ldg-display text-3xl leading-tight text-ink-text">{title}</h1>
          {subtitle && <p className="mt-1.5 text-base text-muted">{subtitle}</p>}
        </div>
        {action && <div className="shrink-0 pb-0.5">{action}</div>}
      </div>
    </header>
  );
}

/** Standard page container — one width, one padding, across screens. */
export function Page({ children, wide, className }: { children: ReactNode; wide?: boolean; className?: string }) {
  return (
    <div className={cn("ldg-rise mx-auto px-5 pb-10 pt-4 sm:px-8 sm:pt-6", wide ? "max-w-6xl" : "max-w-4xl", className)}>
      {children}
    </div>
  );
}
