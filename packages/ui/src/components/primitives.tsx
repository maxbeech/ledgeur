// Shared UI primitives.
//
// These are deliberately presentational and hook-free, so the same file works
// as a React Server Component in the Next.js marketing site and as an ordinary
// component in the Vite app. Anything stateful belongs in the app that owns the
// state, not here.
//
// The point is not to save typing. It is that "a Ledgeur button" should be one
// thing — before this existed, the site had emerald pill buttons and the app
// had spruce ones, and a visitor who signed up met two different products.

import type { ButtonHTMLAttributes, AnchorHTMLAttributes, ReactNode } from "react";
import { cn } from "../cn.ts";
import { speakerColor } from "../tokens.ts";

/* ---------------------------------------------------------------- buttons */

export type ButtonTone = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const TONE: Record<ButtonTone, string> = {
  // accent-strong rather than accent: white on accent is 4.34:1, which fails
  // AA for button text. accent-strong is 6.5:1.
  primary: "bg-accent-strong text-white hover:bg-accent shadow-[0_1px_0_rgba(255,255,255,0.14)_inset]",
  secondary: "border border-hairline-strong bg-surface text-ink-text hover:bg-surface-muted",
  ghost: "text-ink-text hover:bg-surface-muted",
  danger: "bg-danger text-white hover:bg-danger/90",
};

const SIZE: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-[13px]",
  md: "px-4 py-2.5 text-sm",
  lg: "px-6 py-3 text-[15px]",
};

/** Shared shape for every clickable thing, so a link and a button that look the
 *  same really are the same. */
export function buttonClass(tone: ButtonTone = "primary", size: ButtonSize = "md", extra?: string): string {
  return cn(
    "inline-flex items-center justify-center gap-2 rounded-xl font-medium",
    "transition-[background-color,color,transform] duration-200 [transition-timing-function:var(--ease-swift)]",
    "active:translate-y-px disabled:pointer-events-none disabled:opacity-55",
    TONE[tone], SIZE[size], extra,
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: ButtonTone;
  size?: ButtonSize;
}

export function Button({ tone = "primary", size = "md", className, ...rest }: ButtonProps) {
  return <button className={buttonClass(tone, size, className)} {...rest} />;
}

export interface LinkButtonProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  tone?: ButtonTone;
  size?: ButtonSize;
}

export function LinkButton({ tone = "primary", size = "md", className, ...rest }: LinkButtonProps) {
  return <a className={buttonClass(tone, size, className)} {...rest} />;
}

/* ------------------------------------------------------------------ paper */

/** A sheet of paper on the desk. `raised` is for the one thing being read. */
export function Card({
  children, className, raised = false, as: Tag = "div",
}: { children: ReactNode; className?: string; raised?: boolean; as?: "div" | "section" | "article" | "li" }) {
  return (
    <Tag className={cn(
      "rounded-xl border border-hairline bg-surface",
      raised ? "shadow-[var(--shadow-card)]" : "",
      className,
    )}>
      {children}
    </Tag>
  );
}

/** The mono all-caps label above a section. */
export function Kicker({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("ldg-kicker", className)}>{children}</div>;
}

/** Serif display heading. `level` picks the tag; size is set by the caller, so
 *  a section heading and a page heading share a voice but not a scale. */
export function Display({
  children, className, level = 2,
}: { children: ReactNode; className?: string; level?: 1 | 2 | 3 }) {
  const Tag = (`h${level}`) as "h1" | "h2" | "h3";
  return <Tag className={cn("ldg-display text-ink-text", className)}>{children}</Tag>;
}

/* ----------------------------------------------------------------- badges */

export type BadgeTone = "neutral" | "accent" | "glow" | "danger" | "warn";

const BADGE: Record<BadgeTone, string> = {
  neutral: "border-hairline-strong bg-surface-muted text-muted",
  accent: "border-accent/25 bg-accent-soft text-accent-strong",
  glow: "border-glow/25 bg-glow-soft text-glow-strong",
  danger: "border-danger/25 bg-danger-soft text-danger",
  warn: "border-warn/25 bg-warn-soft text-warn",
};

export function Badge({
  children, tone = "neutral", className,
}: { children: ReactNode; tone?: BadgeTone; className?: string }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
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
 * Colour comes from `speakerColor` in tokens.ts, so "Speaker 2" is the same
 * madder red in the live transcript, the saved meeting and any export. A
 * speaker whose colour changed between screens would read as a different
 * person.
 */
export function SpeakerChip({
  label, confidence, className,
}: { label: string; confidence?: number | null; className?: string }) {
  const colour = speakerColor(label);
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-medium", className)}
      style={{ color: colour.fg, backgroundColor: colour.bg }}
    >
      {label}
      {/* A percentage only appears when the name was *guessed*. A name the user
          typed shows no number, because questioning it would be rude. */}
      {confidence != null && (
        <span className="font-mono text-[10px] opacity-70">{Math.round(confidence * 100)}%</span>
      )}
    </span>
  );
}

/* ------------------------------------------------------------------ state */

/**
 * What to show when there is nothing to show.
 *
 * Every empty state takes an action, because an empty screen that only explains
 * itself leaves the user to go and find the button.
 */
export function EmptyState({
  title, body, action, className,
}: { title: string; body: string; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-xl border border-dashed border-hairline-strong px-6 py-12 text-center", className)}>
      <p className="ldg-display text-lg text-ink-text">{title}</p>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted">{body}</p>
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

/**
 * A failure the user can act on.
 *
 * Errors are shown, never swallowed: the product's whole claim is that it is
 * honest about what ran on your machine, and a silent failure is the fastest
 * way to lose that.
 */
export function ErrorNote({
  children, onRetry, className,
}: { children: ReactNode; onRetry?: ReactNode; className?: string }) {
  return (
    <div role="alert" className={cn(
      "rounded-xl border border-danger/25 bg-danger-soft px-4 py-3 text-sm text-danger", className,
    )}>
      <div className="whitespace-pre-line">{children}</div>
      {onRetry && <div className="mt-2">{onRetry}</div>}
    </div>
  );
}

/** A hairline that fades at both ends, the way a printed rule sits on a page. */
export function Rule({ className }: { className?: string }) {
  return <hr className={cn("ldg-rule", className)} />;
}
