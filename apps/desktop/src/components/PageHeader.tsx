import type { ReactNode } from "react";

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-8 flex items-end justify-between gap-4">
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight text-ink-text">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

/** Standard page container — consistent max width + padding across screens. */
export function Page({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-5xl px-8 pb-16 pt-2">{children}</div>;
}
