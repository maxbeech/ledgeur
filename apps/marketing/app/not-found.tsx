import Link from "next/link";
import { buttonClass } from "@ledgeur/ui/components";
import { Wordmark } from "@/components/site/Chrome";

export default function NotFound() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col items-center px-5 py-28 text-center">
      <Wordmark />
      <h1 className="ldg-display mt-8 text-[32px] leading-tight text-ink-text">Page not found</h1>
      <p className="mt-3 max-w-md text-[15px] leading-relaxed text-muted">
        That page does not exist. If you followed a link from somewhere, it was probably from an
        older version of this site.
      </p>
      <div className="mt-7 flex flex-wrap justify-center gap-3">
        <Link href="/app" className={buttonClass("primary", "md")}>Open Ledgeur</Link>
        <Link href="/" className={buttonClass("secondary", "md")}>Back home</Link>
      </div>
      <nav aria-label="Elsewhere" className="mt-9 text-[13.5px] text-muted">
        <Link href="/pricing" className="hover:text-ink-text">Pricing</Link>
        <span aria-hidden> · </span>
        <Link href="/agents" className="hover:text-ink-text">For agents</Link>
        <span aria-hidden> · </span>
        <Link href="/blog" className="hover:text-ink-text">Guides</Link>
        <span aria-hidden> · </span>
        <Link href="/alternatives" className="hover:text-ink-text">Alternatives</Link>
      </nav>
    </main>
  );
}
