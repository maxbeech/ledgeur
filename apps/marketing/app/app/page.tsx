import type { Metadata } from "next";
import { SITE } from "@/lib/site";
import AppShell from "@/components/app/AppShell";
import { Badge } from "@ledgeur/ui/components";

export const metadata: Metadata = {
  title: "Record, transcribe and separate speakers, privately",
  description:
    "Record a meeting or drag one in, and get a transcript with the speakers separated — on your own device. Nothing is uploaded.",
  alternates: { canonical: `${SITE.url}/app` },
};

export default function AppPage() {
  return (
    <main>
      <div className="border-b border-hairline ldg-wash">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-5 lg:px-5">
          <div>
            <h1 className="ldg-display text-[24px] leading-tight text-ink-text">Your meetings</h1>
            <p className="mt-1 text-[13.5px] text-muted">
              Everything on this page runs on your device. Your audio is never uploaded.
            </p>
          </div>
          <Badge tone="accent">On-device</Badge>
        </div>
      </div>
      <AppShell />
    </main>
  );
}
