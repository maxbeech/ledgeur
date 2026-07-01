import { useState } from "react";
import { FileText, Calendar, Cloud, StickyNote, Server, ShieldCheck, LogIn, LogOut, UserCircle, Cpu } from "lucide-react";
import { Page, PageHeader } from "../components/PageHeader.tsx";
import { Button, Card, Chip } from "../components/ui.tsx";
import { hasBackend } from "../lib/config.ts";
import { useSession, signInWith, signOut } from "../lib/session.ts";
import { NotionCard } from "../components/integrations/NotionCard.tsx";
import { McpAccessCard } from "../components/integrations/McpAccessCard.tsx";
import { AiEngineCard } from "../components/integrations/AiEngineCard.tsx";
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
      <PageHeader title="Integrations & data" subtitle="Connect your tools, control sharing, and open your brain to other apps." />

      <SectionTitle icon={<UserCircle className="h-4 w-4" />} title="Account" />
      <Card className="mb-8 flex flex-wrap items-center justify-between gap-4 p-5">
        {session ? (
          <>
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-soft text-accent-strong"><UserCircle className="h-6 w-6" /></span>
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
              <p className="mt-0.5 text-xs text-muted">{hasBackend ? "Use a personal or work account. We request calendar read access for record prompts." : "Configure the Supabase backend to enable sign-in."}</p>
            </div>
            <div className="flex gap-2">
              <Button onClick={() => doSignIn("google")} disabled={!hasBackend}><LogIn className="h-4 w-4" /> Google</Button>
              <Button variant="outline" onClick={() => doSignIn("azure")} disabled={!hasBackend}><LogIn className="h-4 w-4" /> Microsoft</Button>
            </div>
          </>
        )}
      </Card>
      {authErr && <div className="mb-6 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{authErr}</div>}

      <SectionTitle icon={<Cloud className="h-4 w-4" />} title="Connections" />
      <div className="mb-8 grid gap-3 sm:grid-cols-2">
        <NotionCard signedIn={Boolean(session)} />
        {CONNECTIONS.map((c) => (
          <Card key={c.id} className="flex items-start gap-3 p-4">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-muted text-ink-text"><c.icon className="h-5 w-5" /></span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-ink-text">{c.name}</span>
                {c.status === "first" ? <Chip tone="accent">First to ship</Chip> : <Chip>Planned</Chip>}
              </div>
              <p className="mt-0.5 text-xs leading-relaxed text-muted">{c.desc}</p>
              <div className="mt-3">
                <Button variant="outline" disabled={!hasBackend} title={!hasBackend ? "Configure Supabase to enable OAuth connections" : undefined}>
                  {hasBackend ? "Connect" : "Backend required"}
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <SectionTitle icon={<Cpu className="h-4 w-4" />} title="On-device AI" />
      <div className="mb-8"><AiEngineCard /></div>

      <SectionTitle icon={<ShieldCheck className="h-4 w-4" />} title="Sharing & privacy (admin)" />
      <div className="mb-8"><SharingPolicyCard session={session} /></div>

      <SectionTitle icon={<Server className="h-4 w-4" />} title="Data access (MCP)" />
      <McpAccessCard session={session} />
    </Page>
  );
}

function SectionTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return <div className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted">{icon}{title}</div>;
}
