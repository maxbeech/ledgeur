// Settings — account, appearance, connections, automation, on-device AI,
// sharing and agent access. Every card reflects real state; nothing is mocked.
// A phone shows only what a phone can do: no system audio, no webhooks, no
// native engine.
import { Page, PageHeader } from "../components/PageHeader.tsx";
import { Label } from "../components/ui.tsx";
import { useSession } from "../lib/session.ts";
import { useDevice } from "../lib/platform.ts";
import { AccountCard } from "../components/integrations/AccountCard.tsx";
import { SyncCard } from "../components/integrations/SyncCard.tsx";
import { AppearanceCard } from "../components/integrations/AppearanceCard.tsx";
import { NotionCard } from "../components/integrations/NotionCard.tsx";
import { ContextelyCard } from "../components/integrations/ContextelyCard.tsx";
import { GoogleCalendarCard } from "../components/integrations/GoogleCalendarCard.tsx";
import { McpAccessCard } from "../components/integrations/McpAccessCard.tsx";
import { AiEngineCard } from "../components/integrations/AiEngineCard.tsx";
import { CopilotCard } from "../components/integrations/CopilotCard.tsx";
import { VoicesCard } from "../components/integrations/VoicesCard.tsx";
import { SharingPolicyCard } from "../components/integrations/SharingPolicyCard.tsx";
import { RecipesCard } from "../components/integrations/RecipesCard.tsx";
import { WebhookCard } from "../components/integrations/WebhookCard.tsx";
import { AutomationCard } from "../components/integrations/AutomationCard.tsx";

export function Integrations() {
  const { session } = useSession();
  const { phone, native } = useDevice();

  return (
    <Page>
      <PageHeader
        title="Settings"
        subtitle="Your account, how the app looks, what it connects to, and what leaves this device."
      />

      <Section title="Account">
        <div className="space-y-3">
          <AccountCard session={session} />
          <SyncCard />
        </div>
      </Section>

      <Section title="Appearance">
        <AppearanceCard />
      </Section>

      <Section title="Connections">
        <div className="grid gap-3 sm:grid-cols-2">
          <NotionCard signedIn={Boolean(session)} />
          <ContextelyCard signedIn={Boolean(session)} />
          <GoogleCalendarCard />
        </div>
      </Section>

      <Section title="Automation">
        <AutomationCard />
      </Section>

      <Section title="How your notes are written">
        <RecipesCard />
      </Section>

      <Section title="On-device AI">
        <div className="space-y-3">
          {native && !phone && <AiEngineCard />}
          <CopilotCard />
          <VoicesCard />
        </div>
      </Section>

      <Section title="Sharing">
        <SharingPolicyCard session={session} />
      </Section>

      <Section title="Agent access">
        <div className="space-y-3">
          <McpAccessCard session={session} />
          {!phone && <WebhookCard />}
        </div>
      </Section>
    </Page>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <Label as="h2" className="mb-3">{title}</Label>
      {children}
    </section>
  );
}
