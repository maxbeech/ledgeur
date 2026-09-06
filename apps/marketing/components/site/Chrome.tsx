// The furniture every page sits inside: masthead, footer, and the section
// primitives pages are built from.
//
// Server components — no hooks, no client bundle. The mobile menu is a CSS-only
// <details> disclosure for the same reason: a navigation menu should not need
// JavaScript to open.

import Link from "next/link";
import type { ReactNode } from "react";
import { Menu } from "lucide-react";
import { cn } from "@ledgeur/ui";
import { Display, Label, Logo, buttonClass } from "@ledgeur/ui/components";
import { SITE, NAV } from "@/lib/site";

/* ------------------------------------------------------------------- mark */

/** The wordmark, as the design system draws it. */
export function Wordmark({ className, size = "md" }: { className?: string; size?: "sm" | "md" | "lg" }) {
  return <Logo className={className} size={size} />;
}

/* ----------------------------------------------------------------- header */

export function Header() {
  return (
    <header className="sticky top-0 z-30 border-b border-hairline bg-surface/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-5">
        <Link href="/" aria-label={`${SITE.name} home`}>
          <Wordmark />
        </Link>

        <nav aria-label="Primary" className="hidden items-center gap-1 md:flex">
          {NAV.header.map(([label, href]) => (
            <Link key={href} href={href} className="rounded-full px-3.5 py-2 text-base font-medium text-muted transition-colors hover:bg-surface-muted hover:text-ink-text">
              {label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <Link href="/signin" className={buttonClass("ghost", "sm", "rounded-full")}>Sign in</Link>
          <Link href="/app" className={buttonClass("primary", "sm", "rounded-full px-4")}>Open the app</Link>
        </div>

        {/* Mobile: a CSS-only disclosure. No JavaScript to open a menu. */}
        <details className="relative md:hidden">
          <summary
            aria-label="Open menu"
            className="flex h-10 w-10 cursor-pointer list-none items-center justify-center rounded-full text-ink-text hover:bg-surface-muted [&::-webkit-details-marker]:hidden"
          >
            <Menu className="h-5 w-5" aria-hidden />
          </summary>
          <nav
            aria-label="Mobile"
            className="ldg-pop-in absolute right-0 mt-2 w-60 rounded-2xl border border-hairline bg-surface p-2 text-base shadow-[var(--shadow-float)]"
          >
            {NAV.header.map(([label, href]) => (
              <Link key={href} href={href} className="block rounded-lg px-3 py-2 font-medium text-ink-text hover:bg-surface-muted">
                {label}
              </Link>
            ))}
            <hr className="my-1.5 border-hairline" />
            <Link href="/signin" className="block rounded-lg px-3 py-2 font-medium text-ink-text hover:bg-surface-muted">Sign in</Link>
            <Link href="/app" className={cn(buttonClass("primary", "md", "rounded-full"), "mt-1.5 w-full")}>Open the app</Link>
          </nav>
        </details>
      </div>
    </header>
  );
}

/* ----------------------------------------------------------------- footer */

export function Footer() {
  return (
    <footer className="mt-24 border-t border-hairline bg-paper">
      <div className="mx-auto max-w-6xl px-5 py-14">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Wordmark />
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted">
              {SITE.tagline}. Recording, transcription and speaker separation all run on your
              device. We could not read your meetings if we wanted to.
            </p>
          </div>
          <FooterColumn title="Product" links={NAV.product} />
          <FooterColumn title="Learn" links={NAV.learn} />
          <FooterColumn title="Company" links={NAV.company} />
        </div>

        <div className="mt-12 flex flex-col gap-3 border-t border-hairline pt-6 text-xs text-faint sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} {SITE.name}. Open source under the MIT licence.</p>
          <a href={SITE.repo} target="_blank" rel="noreferrer" className="font-medium transition-colors hover:text-ink-text">
            Read the source on GitHub
          </a>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({ title, links }: { title: string; links: readonly (readonly [string, string])[] }) {
  return (
    <div>
      <Label>{title}</Label>
      <ul className="mt-3.5 space-y-2 text-base">
        {links.map(([label, href]) => (
          <li key={href}>
            <Link href={href} className="text-muted transition-colors hover:text-ink-text">{label}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* --------------------------------------------------------------- sections */

/** A page section with consistent rhythm. Every page uses this rather than
 *  choosing its own padding, which is how a site starts to feel assembled. */
export function Section({
  children, className, width = "wide", pad = "normal", tint = false,
}: { children: ReactNode; className?: string; width?: "wide" | "narrow" | "prose"; pad?: "normal" | "tight" | "none"; tint?: boolean }) {
  const max = width === "prose" ? "max-w-2xl" : width === "narrow" ? "max-w-4xl" : "max-w-6xl";
  const py = pad === "none" ? "" : pad === "tight" ? "py-10 sm:py-14" : "py-16 sm:py-24";
  const inner = <div className={cn("mx-auto px-5", max, !tint && py, !tint && className)}>{children}</div>;
  if (!tint) return <section>{inner}</section>;
  return <section className={cn("bg-paper", py, className)}>{inner}</section>;
}

/** Heading + a line of standfirst. The site's one heading pattern, so
 *  sections are recognisably siblings. */
export function SectionHead({
  kicker, title, lede, align = "left", className,
}: { kicker?: string; title: ReactNode; lede?: ReactNode; align?: "left" | "center"; className?: string }) {
  return (
    <div className={cn(align === "center" && "mx-auto max-w-2xl text-center", className)}>
      {kicker && <Label className="mb-3 text-brand-strong">{kicker}</Label>}
      <Display level={2} className="text-3xl leading-[1.15] sm:text-4xl">{title}</Display>
      {lede && <p className="mt-4 text-lg leading-relaxed text-muted">{lede}</p>}
    </div>
  );
}

/** The masthead of an inner page. */
export function PageHeader({
  kicker, title, lede,
}: { kicker?: string; title: string; lede?: ReactNode }) {
  return (
    <div className="mx-auto max-w-6xl px-5 pb-6 pt-14 sm:pt-20">
      {kicker && <Label className="mb-3 text-brand-strong">{kicker}</Label>}
      <Display level={1} className="max-w-3xl text-4xl leading-[1.1] sm:text-5xl">{title}</Display>
      {lede && <p className="mt-5 max-w-2xl text-lg leading-relaxed text-muted">{lede}</p>}
    </div>
  );
}
