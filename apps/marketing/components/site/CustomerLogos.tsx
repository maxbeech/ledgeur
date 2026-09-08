import fs from "node:fs";
import path from "node:path";
import { Label } from "@ledgeur/ui/components";
import { CUSTOMERS, type Customer } from "@/lib/customers";

const LOGO_DIR = path.join(process.cwd(), "public", "logos");

/** Read once at build time, from files this repo owns and this component
 *  itself normalised: not user or request input, so safe to inline raw. */
function readSvg(file: string): string {
  return fs.readFileSync(path.join(LOGO_DIR, file), "utf8");
}

/** An auto-scrolling, infinitely looping strip of the products whose teams
 *  already record their own meetings with Ledgeur. Pure CSS: the loop is a
 *  duplicated track sliding by half its width, so it never has to reset. */
export function CustomerLogos() {
  return (
    <section className="mx-auto max-w-6xl px-5 pb-4 pt-2 sm:pb-8">
      <Label className="text-center">Trusted by teams already on the record with Ledgeur</Label>
      <div className="ldg-marquee-mask relative mt-6">
        <div className="ldg-marquee flex w-max items-center">
          <LogoTrack />
          <LogoTrack ariaHidden />
        </div>
      </div>
    </section>
  );
}

function LogoTrack({ ariaHidden = false }: { ariaHidden?: boolean }) {
  return (
    <div className="flex items-center" aria-hidden={ariaHidden || undefined}>
      {CUSTOMERS.map((c, i) => (
        <LogoItem key={`${c.name}-${ariaHidden ? "dup" : "live"}-${i}`} customer={c} tabIndex={ariaHidden ? -1 : undefined} />
      ))}
    </div>
  );
}

function LogoItem({ customer, tabIndex }: { customer: Customer; tabIndex?: number }) {
  return (
    <a
      href={customer.url}
      target="_blank"
      rel="noopener noreferrer"
      tabIndex={tabIndex}
      aria-label={`${customer.name} (opens in a new tab)`}
      className="ldg-customer-logo mx-5 flex shrink-0 items-center gap-2.5 opacity-55 grayscale transition-[opacity,filter] duration-200 hover:opacity-100 hover:grayscale-0 focus-visible:opacity-100 focus-visible:grayscale-0 sm:mx-7"
    >
      {customer.kind === "text" ? (
        <span className="font-display text-lg font-semibold tracking-tight text-ink-text whitespace-nowrap">
          {customer.name}
        </span>
      ) : (
        <>
          <span className="flex h-7 w-7 shrink-0 items-center justify-center text-ink-text">
            {customer.kind === "svg" ? (
              <span
                className="h-full w-full"
                dangerouslySetInnerHTML={{ __html: readSvg(customer.logo!) }}
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/logos/${customer.logo}`} alt="" className="h-full w-full object-contain" />
            )}
          </span>
          <span className="text-base font-semibold tracking-tight text-ink-text whitespace-nowrap">
            {customer.name}
          </span>
        </>
      )}
    </a>
  );
}
