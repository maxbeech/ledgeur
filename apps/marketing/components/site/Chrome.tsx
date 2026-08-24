// The furniture every page sits inside: masthead, footer, and the section
// primitives pages are built from.
//
// Server components — no hooks, no client bundle. The mobile menu is a CSS-only
// <details> disclosure for the same reason: a navigation menu should not need
// JavaScript to open.

import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@ledgeur/ui";
import { Display, Kicker, buttonClass } from "@ledgeur/ui/components";
import { SITE, NAV } from "@/lib/site";

/* ------------------------------------------------------------------- mark */

/** The wordmark. A bookplate: a serif L on spruce, the way a library stamps
 *  ownership into the front of a book. */
export function Wordmark({ className, inverted = false }: { className?: string; inverted?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <span
        aria-hidden
        className={cn(
          "grid h-8 w-8 place-items-center rounded-[0.6rem] font-[560] leading-none",
          "ldg-display text-[17px]",
          inverted ? "bg-paper text-ink" : "bg-ink text-paper",
        )}
      >
        L
      </span>
      <span className={cn("ldg-display text-[19px] tracking-[-0.02em]", inverted ? "text-on-ink" : "text-ink-text")}>
        Ledgeur
      </span>
    </span>
  );
}

/* ----------------------------------------------------------------- header */

const PRIMARY: readonly (readonly [string, string])[] = [
  ["Download", "/download"],
  ["Pricing", "/pricing"],
  ["For agents", "/agents"],
  ["Blog", "/blog"],
  ["Alternatives", "/alternatives"],
];

export function Header() {
  return (
    <header className="sticky top-0 z-30 border-b border-hairline bg-paper/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3.5">
        <Link href="/" aria-label={`${SITE.name} home`}>
          <Wordmark />
        </Link>

        <nav aria-label="Primary" className="hidden items-center gap-6 text-[13.5px] text-muted md:flex">
          {PRIMARY.map(([label, href]) => (
            <Link key={href} href={href} className="transition-colors hover:text-ink-text">
              {label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <Link href="/signin" className={buttonClass("ghost", "sm")}>Sign in</Link>
          <Link href="/app" className={buttonClass("primary", "sm")}>Open the app</Link>
        </div>

        {/* Mobile: a CSS-only disclosure. No JavaScript to open a menu. */}
        <details className="relative md:hidden">
          <summary
            aria-label="Open menu"
            className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-lg border border-hairline-strong text-ink-text [&::-webkit-details-marker]:hidden"
          >
            <span aria-hidden>☰</span>
          </summary>
          <nav
            aria-label="Mobile"
            className="ldg-fade-in absolute right-0 mt-2 w-56 rounded-xl border border-hairline bg-surface p-2 text-sm shadow-[var(--shadow-float)]"
          >
            {PRIMARY.map(([label, href]) => (
              <Link key={href} href={href} className="block rounded-lg px-3 py-2 text-ink-text hover:bg-surface-muted">
                {label}
              </Link>
            ))}
            <hr className="my-1.5 border-hairline" />
            <Link href="/signin" className="block rounded-lg px-3 py-2 text-ink-text hover:bg-surface-muted">Sign in</Link>
            <Link href="/app" className={cn(buttonClass("primary", "sm"), "mt-1 w-full")}>Open the app</Link>
          </nav>
        </details>
      </div>
    </header>
  );
}

/* ----------------------------------------------------------------- footer */

export function Footer() {
  return (
    <footer className="mt-24 border-t border-hairline bg-ink text-on-ink-muted">
      <div className="mx-auto max-w-6xl px-5 py-14">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Wordmark inverted />
            <p className="mt-4 max-w-xs text-[13px] leading-relaxed">
              {SITE.tagline}. Recording, transcription and speaker separation all run on your
              device. We could not read your meetings if we wanted to.
            </p>
          </div>
          <FooterColumn title="Product" links={NAV.product} />
          <FooterColumn title="Learn" links={NAV.learn} />
          <FooterColumn title="Company" links={NAV.company} />
        </div>

        <div className="mt-12 flex flex-col gap-3 border-t border-white/10 pt-6 text-[12px] sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} {SITE.name}. Open source under the MIT licence.</p>
          <a href={SITE.repo} target="_blank" rel="noreferrer" className="transition-colors hover:text-on-ink">
            Read the source on GitHub →
          </a>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({ title, links }: { title: string; links: readonly (readonly [string, string])[] }) {
  return (
    <div>
      <div className="ldg-kicker !text-on-ink-muted">{title}</div>
      <ul className="mt-3.5 space-y-2 text-[13.5px]">
        {links.map(([label, href]) => (
          <li key={href}>
            <Link href={href} className="transition-colors hover:text-on-ink">{label}</Link>
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
  children, className, width = "wide",
}: { children: ReactNode; className?: string; width?: "wide" | "narrow" | "prose" }) {
  const max = width === "prose" ? "max-w-2xl" : width === "narrow" ? "max-w-4xl" : "max-w-6xl";
  return <section className={cn("mx-auto px-5 py-16 sm:py-20", max, className)}>{children}</section>;
}

/** Kicker + serif heading + a line of standfirst. The site's one heading
 *  pattern, so sections are recognisably siblings. */
export function SectionHead({
  kicker, title, lede, align = "left", className,
}: { kicker?: string; title: ReactNode; lede?: ReactNode; align?: "left" | "center"; className?: string }) {
  return (
    <div className={cn(align === "center" && "mx-auto max-w-2xl text-center", className)}>
      {kicker && <Kicker>{kicker}</Kicker>}
      <Display level={2} className={cn("text-[26px] leading-tight sm:text-[32px]", kicker && "mt-3")}>
        {title}
      </Display>
      {lede && <p className="mt-3.5 text-[15px] leading-relaxed text-muted">{lede}</p>}
    </div>
  );
}

/** The masthead of an inner page. */
export function PageHeader({
  kicker, title, lede,
}: { kicker?: string; title: string; lede?: ReactNode }) {
  return (
    <div className="border-b border-hairline ldg-wash">
      <div className="mx-auto max-w-6xl px-5 pb-12 pt-14 sm:pb-16 sm:pt-20">
        {kicker && <Kicker>{kicker}</Kicker>}
        <Display level={1} className={cn("max-w-3xl text-[32px] leading-[1.1] sm:text-[44px]", kicker && "mt-3")}>
          {title}
        </Display>
        {lede && <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-muted">{lede}</p>}
      </div>
    </div>
  );
}
