// Settings — account, connections, on-device AI, voices, sharing and the paid
// MCP data tier. Every card reflects real state; nothing is mocked.
import { FileText, Cloud, StickyNote } from "lucide-react";
import { Page, PageHeader } from "../components/PageHeader.tsx";
import { Button, Card, Chip, Kicker } from "../components/ui.tsx";
import { hasBackend } from "../lib/config.ts";
import { useSession } from "../lib/session.ts";
import { AccountCard } from "../components/integrations/AccountCard.tsx";
import { NotionCard } from "../components/integrations/NotionCard.tsx";
import { GoogleCalendarCard } from "../components/integrations/GoogleCalendarCard.tsx";
import { McpAccessCard } from "../components/integrations/McpAccessCard.tsx";
import { AiEngineCard } from "../components/integrations/AiEngineCard.tsx";
import { CopilotCard } from "../components/integrations/CopilotCard.tsx";
import { VoicesCard } from "../components/integrations/VoicesCard.tsx";
import { SharingPolicyCard } from "../components/integrations/SharingPolicyCard.tsx";

const CONNECTIONS = [
  { id: "microsoft", name: "Microsoft 365", desc: "Outlook calendar + Teams meeting detection.", icon: Cloud },
  { id: "google_docs", name: "Google Docs", desc: "Export notes to a Google Doc.", icon: FileText },
  { id: "onenote", name: "OneNote", desc: "Export notes to a OneNote section.", icon: StickyNote },
] as const;

export function Integrations() {
  const { session } = useSession();

  return (
    <Page>
      <PageHeader
        kicker="Settings"
        title="Integrations & data"
        subtitle="Connect your tools, control sharing, and open your brain to other apps."
      />

      <div className="ldg-stagger">
        <Section title="Account">
          <AccountCard session={session} />
        </Section>

        <Section title="Connections">
          <div className="grid gap-3 sm:grid-cols-2">
            <NotionCard signedIn={Boolean(session)} />
            <GoogleCalendarCard />
            {CONNECTIONS.map((c) => (
              <Card key={c.id} className="flex items-start gap-3 p-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-muted text-ink-text"><c.icon className="h-5 w-5" /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-ink-text">{c.name}</span>
                    <Chip>planned</Chip>
                  </div>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted">{c.desc}</p>
                  <div className="mt-3">
                    <Button size="sm" variant="outline" disabled={!hasBackend} title={!hasBackend ? "Configure Supabase to enable OAuth connections" : undefined}>
                      {hasBackend ? "Connect" : "Backend required"}
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </Section>

        <Section title="On-device AI">
          <div className="space-y-3">
            <AiEngineCard />
            <CopilotCard />
            <VoicesCard />
          </div>
        </Section>

        <Section title="Sharing & privacy (admin)">
          <SharingPolicyCard session={session} />
        </Section>

        <Section title="Data access (MCP)">
          <McpAccessCard session={session} />
        </Section>
      </div>
    </Page>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-9">
      <Kicker className="mb-3">{title}</Kicker>
      {children}
    </section>
  );
}
