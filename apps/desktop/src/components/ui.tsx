// Shared UI primitives — one definition each, reused across all screens.
// Voice: "Library of Record". Ink buttons, paper sheets, mono kickers.
// Color semantics: emerald = live/you · gold = the brain · madder = recording.
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@ledgeur/ui";

type Variant = "primary" | "accent" | "gold" | "ghost" | "outline" | "danger";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-ink text-on-ink hover:bg-ink-soft shadow-sm",
  accent: "bg-accent-strong text-white hover:bg-accent shadow-sm",
  gold: "bg-glow-strong text-white hover:bg-glow shadow-sm",
  ghost: "text-ink-text/75 hover:bg-surface-muted hover:text-ink-text",
  outline: "border border-hairline-strong/70 bg-surface text-ink-text hover:border-ink/30 hover:bg-surface-muted/60",
  danger: "bg-danger text-white hover:opacity-90",
};

export function Button({
  variant = "primary", size = "md", className, children, ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg" }) {
  const sizes = { sm: "px-3 py-1.5 text-[13px] rounded-lg", md: "px-4 py-2.5 text-sm rounded-xl", lg: "px-5 py-3 text-[15px] rounded-xl" };
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 font-medium select-none",
        "transition-all duration-150 ease-[var(--ease-swift)] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50",
        "disabled:opacity-45 disabled:pointer-events-none active:scale-[0.98]",
        sizes[size], VARIANTS[variant], className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("rounded-2xl border border-hairline bg-surface shadow-[var(--shadow-card)]", className)}>
      {children}
    </div>
  );
}

/** Mono small-caps label — the editorial section voice. */
export function Kicker({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("ldg-kicker", className)}>{children}</div>;
}

export function Chip({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "accent" | "gold" | "warn" | "danger" }) {
  const tones = {
    neutral: "bg-surface-muted text-muted",
    accent: "bg-accent-soft text-accent-strong",
    gold: "bg-glow-soft text-glow-strong",
    warn: "bg-warn-soft text-warn",
    danger: "bg-danger-soft text-danger",
  };
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 font-mono text-[10.5px] font-medium tracking-wide", tones[tone])}>
      {children}
    </span>
  );
}

export function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-4">
      <Kicker>{title}</Kicker>
      {action}
    </div>
  );
}

export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {icon && <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-hairline bg-surface-muted/60 text-muted">{icon}</div>}
      <h3 className="ldg-display text-[19px] text-ink-text">{title}</h3>
      <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-muted">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorNote({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-xl border border-danger/20 bg-danger-soft/60 px-3.5 py-2.5 text-[13px] leading-relaxed text-danger", className)}>
      {children}
    </div>
  );
}

export function Toggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!on)}
      role="switch"
      aria-checked={on}
      disabled={disabled}
      className={cn(
        "relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200 disabled:opacity-50",
        on ? "bg-accent-strong" : "bg-hairline-strong",
      )}
    >
      <span className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all duration-200 ease-[var(--ease-settle)]", on ? "left-[22px]" : "left-0.5")} />
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn("h-4 w-4 animate-spin", className)} viewBox="0 0 24 24" fill="none" aria-label="Loading">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path className="opacity-90" d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
