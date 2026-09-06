import type { Metadata } from "next";
import { SITE } from "@/lib/site";
import AppShell from "@/components/app/AppShell";
import { Badge, Display } from "@ledgeur/ui/components";

export const metadata: Metadata = {
  title: "Record, transcribe and separate speakers, privately",
  description:
    "Record a meeting or drag one in, and get a transcript with the speakers separated — on your own device. Nothing is uploaded.",
  alternates: { canonical: `${SITE.url}/app` },
};

export default function AppPage() {
  return (
    <main>
      <div className="border-b border-hairline bg-paper">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-5">
          <div>
            <Display level={1} className="text-2xl leading-tight">Your meetings</Display>
            <p className="mt-1 text-sm text-muted">Everything on this page runs on your device. Your audio is never uploaded.</p>
          </div>
          <Badge tone="accent">On-device</Badge>
        </div>
      </div>
      <AppShell />
    </main>
  );
}
