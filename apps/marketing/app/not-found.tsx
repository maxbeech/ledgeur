import Link from "next/link";
import { Display, buttonClass } from "@ledgeur/ui/components";
import { Wordmark } from "@/components/site/Chrome";

export default function NotFound() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col items-center px-5 py-28 text-center">
      <Wordmark />
      <Display level={1} className="mt-8 text-4xl leading-tight">Page not found</Display>
      <p className="mt-3 max-w-md text-md leading-relaxed text-muted">
        That page does not exist. If you followed a link from somewhere, it was probably from an
        older version of this site.
      </p>
      <div className="mt-7 flex flex-wrap justify-center gap-3">
        <Link href="/app" className={buttonClass("primary", "md", "rounded-full px-5")}>Open Ledgeur</Link>
        <Link href="/" className={buttonClass("secondary", "md", "rounded-full px-5")}>Back home</Link>
      </div>
      <nav aria-label="Elsewhere" className="mt-9 flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm font-medium text-muted">
        <Link href="/pricing" className="hover:text-ink-text">Pricing</Link>
        <Link href="/agents" className="hover:text-ink-text">For agents</Link>
        <Link href="/blog" className="hover:text-ink-text">Guides</Link>
        <Link href="/alternatives" className="hover:text-ink-text">Alternatives</Link>
      </nav>
    </main>
  );
}
