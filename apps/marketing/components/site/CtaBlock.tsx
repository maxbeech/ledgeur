// The closing call to action, defined once.
//
// Every SEO page ended with its own hand-rolled variant of this, which is how a
// site ends up with six slightly different boxes. One component, one promise.

import Link from "next/link";
import { Display, buttonClass } from "@ledgeur/ui/components";

export function CtaBlock({
  title = "Try it on a meeting you have already recorded.",
  body = "Drag a recording into Ledgeur and get a transcript with the speakers separated — in your browser, with nothing uploaded. Free, permanently, and no account needed.",
}: { title?: string; body?: string }) {
  return (
    <div className="mt-16 rounded-3xl bg-brand-soft px-6 py-10 text-center sm:px-10 sm:py-12">
      <Display level={2} className="text-2xl sm:text-3xl">{title}</Display>
      <p className="mx-auto mt-3 max-w-md text-base leading-relaxed text-muted">{body}</p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Link href="/app" className={buttonClass("primary", "md", "rounded-full px-5")}>Open Ledgeur</Link>
        <Link href="/pricing" className={buttonClass("secondary", "md", "rounded-full px-5")}>See pricing</Link>
      </div>
    </div>
  );
}
