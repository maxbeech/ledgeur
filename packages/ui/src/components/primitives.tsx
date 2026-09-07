// Shared UI primitives — one definition each, for every Ledgeur surface.
//
// Deliberately presentational and hook-free, so the same file works as a React
// Server Component on the site and as an ordinary component in the app.
// Anything stateful belongs to the app that owns the state.
//
// The point is not to save typing. It is that "a Ledgeur button" is one thing.
// Before this was the only set, the site's primary button was green and the
// app's was spruce, and a person who signed up met two different products.

import type { ButtonHTMLAttributes, AnchorHTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes, ReactNode } from "react";
import { cn } from "../cn.ts";
import { speakerIndex, pastelFor, type PastelName } from "../tokens.ts";

/* ---------------------------------------------------------------- buttons */

export type ButtonTone = "primary" | "secondary" | "soft" | "ghost" | "danger" | "brand";
export type ButtonSize = "sm" | "md" | "lg";

const TONE: Record<ButtonTone, string> = {
  primary: "bg-ink text-on-ink hover:bg-ink-soft",
  secondary: "border border-hairline-strong bg-surface text-ink-text hover:bg-surface-muted",
  soft: "bg-surface-muted text-ink-text hover:bg-surface-sunken",
  ghost: "text-ink-text hover:bg-surface-muted",
  danger: "bg-danger-fill text-on-danger hover:brightness-95",
  brand: "bg-brand-soft text-brand-strong hover:brightness-95",
};

const SIZE: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-sm rounded-md",
  md: "h-10 px-4 text-base rounded-lg",
  lg: "h-12 px-6 text-md rounded-xl",
};

/** Shared shape for every clickable thing, so a link and a button that look the
 *  same really are the same. */
export function buttonClass(tone: ButtonTone = "primary", size: ButtonSize = "md", extra?: string): string {
  return cn(
    "inline-flex shrink-0 items-center justify-center gap-2 font-semibold whitespace-nowrap select-none",
    "transition-[background-color,color,transform,filter] duration-150 [transition-timing-function:var(--ease-swift)]",
    "active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50",
    TONE[tone], SIZE[size], extra,
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: ButtonTone;
  size?: ButtonSize;
}

export function Button({ tone = "primary", size = "md", className, type = "button", ...rest }: ButtonProps) {
  return <button type={type} className={buttonClass(tone, size, className)} {...rest} />;
}

export interface LinkButtonProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  tone?: ButtonTone;
  size?: ButtonSize;
}

export function LinkButton({ tone = "primary", size = "md", className, ...rest }: LinkButtonProps) {
  return <a className={buttonClass(tone, size, className)} {...rest} />;
}

const ICON_SIZE: Record<ButtonSize, string> = { sm: "h-8 w-8 rounded-md", md: "h-10 w-10 rounded-lg", lg: "h-12 w-12 rounded-xl" };

/** A square button holding one icon. `label` is required: an icon alone is
 *  not a name. */
export function IconButton({
  label, tone = "ghost", size = "md", className, type = "button", ...rest
}: ButtonProps & { label: string }) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex shrink-0 items-center justify-center transition-[background-color,color,transform] duration-150",
        "active:scale-[0.96] disabled:pointer-events-none disabled:opacity-50",
        TONE[tone], ICON_SIZE[size], className,
      )}
      {...rest}
    />
  );
}

/* ------------------------------------------------------------------ paper */

/** A card. `raised` is for the one thing being read or acted on. */
export function Card({
  children, className, raised = false, as: Tag = "div",
}: { children: ReactNode; className?: string; raised?: boolean; as?: "div" | "section" | "article" | "li" | "form" }) {
  return (
    <Tag className={cn(
      "rounded-xl border border-hairline bg-surface",
      raised && "shadow-[var(--shadow-card)]",
      className,
    )}>
      {children}
    </Tag>
  );
}

/** A section label. Small, semibold, sentence case. */
export function Label({ children, className, as: Tag = "div" }: { children: ReactNode; className?: string; as?: "div" | "span" | "h2" | "h3" | "label" }) {
  return <Tag className={cn("ldg-label", className)}>{children}</Tag>;
}

/** Display heading. `level` picks the tag; the size is the caller's, so a page
 *  heading and a card heading share a voice but not a scale. */
export function Display({
  children, className, level = 2,
}: { children: ReactNode; className?: string; level?: 1 | 2 | 3 }) {
  const Tag = (`h${level}`) as "h1" | "h2" | "h3";
  return <Tag className={cn("ldg-display text-ink-text", className)}>{children}</Tag>;
}

/* ----------------------------------------------------------------- badges */

export type BadgeTone = "neutral" | "brand" | "accent" | "danger" | "warn" | PastelName;

const BADGE: Record<BadgeTone, string> = {
  neutral: "bg-surface-muted text-muted",
  brand: "bg-brand-soft text-brand-strong",
  accent: "bg-accent-soft text-accent-strong",
  danger: "bg-danger-soft text-danger",
  warn: "bg-warn-soft text-warn",
  iris: "bg-iris-soft text-iris-strong",
  mint: "bg-mint-soft text-mint-strong",
  peach: "bg-peach-soft text-peach-strong",
  butter: "bg-butter-soft text-butter-strong",
  sky: "bg-sky-soft text-sky-strong",
  rose: "bg-rose-soft text-rose-strong",
};

/** A small pill of state. Pastel on its own tint, never bordered. */
export function Badge({
  children, tone = "neutral", className,
}: { children: ReactNode; tone?: BadgeTone; className?: string }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold leading-5",
      BADGE[tone], className,
    )}>
      {children}
    </span>
  );
}

/* --------------------------------------------------------------- speakers */

/**
 * A speaker's name in their assigned colour.
 *
 * Colour comes from `speakerIndex` in tokens.ts, so "Speaker 2" is the same
 * rose in the live transcript, the saved meeting, the site and any export. A
 * speaker whose colour changed between screens would read as a different
 * person.
 */
export function SpeakerChip({
  label, confidence, className,
}: { label: string; confidence?: number | null; className?: string }) {
  return (
    <span className={cn(
      `ldg-speaker ldg-speaker-${speakerIndex(label)}`,
      "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold leading-5",
      className,
    )}>
      {label}
      {/* A percentage only appears when the name was *guessed*. A name the user
          typed shows no number, because questioning it would be rude. */}
      {confidence != null && (
        <span className="ldg-num text-2xs opacity-70">{Math.round(confidence * 100)}%</span>
      )}
    </span>
  );
}

/** A person, as initials on their family's tint. Deterministic from the name,
 *  so Priya is the same colour on every device. */
export function Avatar({ name, size = "md", className }: { name: string; size?: "sm" | "md" | "lg"; className?: string }) {
  const initials = name.trim().split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
  const tone = pastelFor(name);
  const dims = size === "sm" ? "h-7 w-7 text-2xs" : size === "lg" ? "h-12 w-12 text-md" : "h-9 w-9 text-xs";
  return (
    <span
      aria-hidden
      className={cn("inline-flex shrink-0 select-none items-center justify-center rounded-full font-bold", dims, BADGE[tone], className)}
    >
      {initials}
    </span>
  );
}

/* ------------------------------------------------------------------ forms */

/** The one input shape. */
export function inputClass(extra?: string): string {
  return cn(
    "w-full rounded-lg border border-hairline-strong bg-surface px-3.5 py-2.5 text-base text-ink-text",
    "placeholder:text-faint outline-none transition-[border-color,box-shadow] duration-150",
    "focus:border-brand focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-brand)_22%,transparent)]",
    "disabled:opacity-60",
    extra,
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={inputClass(className)} {...rest} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={inputClass(cn("appearance-none pr-9 bg-no-repeat bg-[right_0.85rem_center] bg-[length:14px] bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2362656e' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")]", className))} {...rest}>{children}</select>;
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={inputClass(cn("resize-y leading-relaxed", className))} {...rest} />;
}

/** Label + control + hint, stacked the same way everywhere. */
export function Field({
  label, hint, htmlFor, children, className,
}: { label: ReactNode; hint?: ReactNode; htmlFor?: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-semibold text-ink-text">{label}</label>
      {children}
      {hint && <p className="mt-1.5 text-xs leading-relaxed text-faint">{hint}</p>}
    </div>
  );
}

/** A switch. Controlled; the owner keeps the state. */
export function Toggle({
  on, onChange, disabled, label,
}: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!on)}
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      className={cn(
        "relative h-[26px] w-[44px] shrink-0 rounded-full transition-colors duration-200 disabled:opacity-50",
        on ? "bg-ink" : "bg-hairline-strong",
      )}
    >
      <span className={cn(
        "absolute top-[3px] h-5 w-5 rounded-full bg-surface shadow-[0_1px_2px_rgb(0_0_0/0.25)] transition-[left] duration-200 [transition-timing-function:var(--ease-settle)]",
        on ? "left-[21px]" : "left-[3px]",
      )} />
    </button>
  );
}

/** Two to four choices, one of which is on. */
export function Segmented<T extends string>({
  options, value, onChange, className, size = "md",
}: { options: readonly { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; className?: string; size?: "sm" | "md" }) {
  return (
    <div role="tablist" className={cn("inline-flex rounded-lg bg-surface-muted p-1", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md font-semibold transition-[background-color,color,box-shadow] duration-150",
            size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-1.5 text-sm",
            o.value === value ? "bg-surface text-ink-text shadow-[var(--shadow-card)]" : "text-muted hover:text-ink-text",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ state */

/** A spinner. The one spinner. */
export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn("h-4 w-4 animate-spin", className)} viewBox="0 0 24 24" fill="none" aria-label="Loading" role="status">
      <circle className="opacity-20" cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" />
      <path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/** A progress bar. `value` 0–100, or null for "working, unknown how long". */
export function ProgressBar({ value, tone = "brand", className }: { value: number | null; tone?: "brand" | "accent"; className?: string }) {
  const fill = tone === "brand" ? "bg-brand" : "bg-accent";
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken", className)} role="progressbar" aria-valuenow={value ?? undefined} aria-valuemin={0} aria-valuemax={100}>
      <div
        className={cn("h-full rounded-full transition-[width] duration-300", fill, value == null && "ldg-pulse w-1/3")}
        style={value != null ? { width: `${Math.max(3, Math.min(100, value))}%` } : undefined}
      />
    </div>
  );
}

export type NoticeTone = "neutral" | "brand" | "accent" | "warn" | "danger";

const NOTICE: Record<NoticeTone, string> = {
  neutral: "bg-surface-muted text-ink-text",
  brand: "bg-brand-soft text-ink-text",
  accent: "bg-accent-soft text-ink-text",
  warn: "bg-warn-soft text-ink-text",
  danger: "bg-danger-soft text-ink-text",
};

/** A line of state with a tint: a success, a caveat, something to know. */
export function Notice({
  children, tone = "neutral", icon, action, className,
}: { children: ReactNode; tone?: NoticeTone; icon?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("flex items-start gap-2.5 rounded-lg px-3.5 py-2.5 text-sm leading-relaxed", NOTICE[tone], className)}>
      {icon && <span className="mt-0.5 shrink-0">{icon}</span>}
      <div className="min-w-0 flex-1">{children}</div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/**
 * What to show when there is nothing to show.
 *
 * Every empty state takes an action, because an empty screen that only explains
 * itself leaves the person to go and find the button.
 */
export function EmptyState({
  icon, title, body, action, className,
}: { icon?: ReactNode; title: string; body: string; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center px-6 py-12 text-center", className)}>
      {icon && <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-brand-soft text-brand-strong">{icon}</div>}
      <p className="text-lg font-semibold text-ink-text">{title}</p>
      <p className="mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-muted">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/**
 * A failure the person can act on.
 *
 * Errors are shown, never swallowed: the product's whole claim is that it is
 * honest about what ran on your machine, and a silent failure is the fastest
 * way to lose that.
 */
export function ErrorNote({
  children, onRetry, className,
}: { children: ReactNode; onRetry?: ReactNode; className?: string }) {
  return (
    <div role="alert" className={cn("rounded-lg bg-danger-soft px-3.5 py-2.5 text-sm leading-relaxed text-danger", className)}>
      <div className="whitespace-pre-line">{children}</div>
      {onRetry && <div className="mt-2">{onRetry}</div>}
    </div>
  );
}

/** A hairline rule. */
export function Rule({ className }: { className?: string }) {
  return <hr className={cn("ldg-rule", className)} />;
}

/* ------------------------------------------------------------------- mark */

/** The mark alone, from /logo.png — served by each app's own public/ directory. */
export function LogoMark({ className }: { className?: string }) {
  return <img src="/logo.png" alt="" aria-hidden className={cn("object-contain", className)} />;
}

/**
 * The mark and wordmark together, from /logo_with_text.png when `wordmark`
 * is on. The wordmark's text is baked into the PNG in near-black, so a
 * second, light-text PNG stands in on dark surfaces — see `.ldg-logo-dark`
 * in theme.css.
 */
export function Logo({ className, size = "md", wordmark = true }: { className?: string; size?: "sm" | "md" | "lg"; wordmark?: boolean }) {
  const markSize = size === "sm" ? "h-7 w-7" : size === "lg" ? "h-11 w-11" : "h-8 w-8";
  const lockupHeight = size === "sm" ? "h-6" : size === "lg" ? "h-9" : "h-7";
  return wordmark ? (
    <span className={cn("inline-flex", className)}>
      <img src="/logo_with_text.png" alt="Ledgeur" className={cn(lockupHeight, "ldg-logo-light w-auto object-contain")} />
      <img src="/logo_with_text_dark.png" alt="Ledgeur" className={cn(lockupHeight, "ldg-logo-dark w-auto object-contain")} />
    </span>
  ) : (
    <LogoMark className={cn(markSize, className)} />
  );
}
