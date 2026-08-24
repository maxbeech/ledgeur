// The closing call to action, defined once.
//
// Every SEO page ended with its own hand-rolled variant of this, which is how a
// site ends up with six slightly different green boxes. One component, one
// promise.

import Link from "next/link";
import { Card, buttonClass } from "@ledgeur/ui/components";

export function CtaBlock({
  title = "Try it on a meeting you have already recorded.",
  body = "Drag a recording into Ledgeur and get a transcript with the speakers separated — in your browser, with nothing uploaded. Free, permanently, and no account needed.",
}: { title?: string; body?: string }) {
  return (
    <Card raised className="mt-14 p-7 text-center">
      <h2 className="ldg-display text-[20px] text-ink-text">{title}</h2>
      <p className="mx-auto mt-2.5 max-w-md text-[14px] leading-relaxed text-muted">{body}</p>
      <div className="mt-5 flex flex-wrap justify-center gap-3">
        <Link href="/app" className={buttonClass("primary", "md")}>Open Ledgeur</Link>
        <Link href="/pricing" className={buttonClass("secondary", "md")}>See pricing</Link>
      </div>
    </Card>
  );
}
