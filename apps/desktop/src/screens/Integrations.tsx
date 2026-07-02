// Settings — account, connections, on-device AI, voices, sharing and the paid
// MCP data tier. Every card reflects real state; nothing is mocked.
import { useState } from "react";
import { FileText, Calendar, Cloud, StickyNote, LogIn, LogOut } from "lucide-react";
import { Page, PageHeader } from "../components/PageHeader.tsx";
import { Button, Card, Chip, ErrorNote, Kicker } from "../components/ui.tsx";
import { hasBackend } from "../lib/config.ts";
import { useSession, signInWith, signOut } from "../lib/session.ts";
import { NotionCard } from "../components/integrations/NotionCard.tsx";
import { McpAccessCard } from "../components/integrations/McpAccessCard.tsx";
import { AiEngineCard } from "../components/integrations/AiEngineCard.tsx";
import { VoicesCard } from "../components/integrations/VoicesCard.tsx";
import { SharingPolicyCard } from "../components/integrations/SharingPolicyCard.tsx";

const CONNECTIONS = [
  { id: "google", name: "Google Calendar", desc: "See meetings and get one-click record prompts. Personal or work.", icon: Calendar, status: "first" },
  { id: "microsoft", name: "Microsoft 365", desc: "Outlook calendar + Teams meeting detection.", icon: Cloud, status: "planned" },
  { id: "google_docs", name: "Google Docs", desc: "Export notes to a Google Doc.", icon: FileText, status: "planned" },
  { id: "onenote", name: "OneNote", desc: "Export notes to a OneNote section.", icon: StickyNote, status: "planned" },
] as const;

export function Integrations() {
  const { session } = useSession();
  const [authErr, setAuthErr] = useState("");
  const doSignIn = (p: "google" | "azure") => signInWith(p).catch((e) => setAuthErr(e instanceof Error ? e.message : String(e)));

  return (
    <Page>
      <PageHeader
        kicker="Settings"
        title="Integrations & data"
        subtitle="Connect your tools, control sharing, and open your brain to other apps."
      />

      <div className="pn-stagger">
        <Section title="Account">
          <Card className="flex flex-wrap items-center justify-between gap-4 p-5">
            {session ? (
              <>
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-accent/70 to-glow/60 font-mono text-[13px] font-semibold uppercase text-white">
                    {session.user.email?.slice(0, 2) ?? "PN"}
                  </span>
                  <div>
                    <div className="text-sm font-medium text-ink-text">{session.user.email}</div>
                    <div className="text-xs text-muted">Signed in · syncing to your company brain</div>
                  </div>
                </div>
                <Button variant="outline" onClick={() => void signOut()}><LogOut className="h-4 w-4" /> Sign out</Button>
              </>
            ) : (
              <>
                <div>
                  <div className="text-sm font-medium text-ink-text">Sign in to sync & unlock the hive mind</div>
                  <p className="mt-0.5 max-w-md text-xs leading-relaxed text-muted">
                    {hasBackend ? "Use a personal or work account. We request calendar read access for record prompts." : "Configure the Supabase backend to enable sign-in."}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button onClick={() => void doSignIn("google")} disabled={!hasBackend}><LogIn className="h-4 w-4" /> Google</Button>
                  <Button variant="outline" onClick={() => void doSignIn("azure")} disabled={!hasBackend}><LogIn className="h-4 w-4" /> Microsoft</Button>
                </div>
              </>
            )}
          </Card>
          {authErr && <ErrorNote className="mt-3">{authErr}</ErrorNote>}
        </Section>

        <Section title="Connections">
          <div className="grid gap-3 sm:grid-cols-2">
            <NotionCard signedIn={Boolean(session)} />
            {CONNECTIONS.map((c) => (
              <Card key={c.id} className="flex items-start gap-3 p-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-muted text-ink-text"><c.icon className="h-5 w-5" /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-ink-text">{c.name}</span>
                    {c.status === "first" ? <Chip tone="accent">first to ship</Chip> : <Chip>planned</Chip>}
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
