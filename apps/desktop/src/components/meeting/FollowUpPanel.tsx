// The follow-up email, drafted from the meeting that just happened.
//
// Editable before it goes anywhere: the draft is a starting point, and the one
// thing worse than no draft is a draft that gets sent unread. "Open in mail"
// hands it to whatever mail app the person actually uses rather than asking for
// their mailbox credentials — Ledgeur never needs to see their email.

import { useState } from "react";
import { Mail, Copy, Check, Sparkles, ExternalLink, RefreshCw } from "lucide-react";
import { mailtoUrl, type FollowUpEmail } from "@ledgeur/core";
import { Button, Card, Chip, ErrorNote, Kicker, Spinner } from "../ui.tsx";
import { draftFollowUp } from "../../lib/followUp.ts";
import type { LocalMeeting } from "../../lib/meetingsStore.ts";

export function FollowUpPanel({ meeting }: { meeting: LocalMeeting }) {
  const [draft, setDraft] = useState<FollowUpEmail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [to, setTo] = useState("");

  async function generate() {
    setBusy(true);
    setError("");
    try {
      setDraft(await draftFollowUp(meeting));
    } catch (e) {
      // draftFollowUp falls back rather than failing, so reaching here means
      // something genuinely unexpected — say what it was.
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!draft) return;
    await navigator.clipboard.writeText(`Subject: ${draft.subject}\n\n${draft.body}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (!draft) {
    return (
      <Card className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-1 flex items-center gap-2"><Mail className="h-4 w-4 text-accent-strong" /><Kicker>Follow-up</Kicker></div>
            <p className="text-sm leading-relaxed text-muted">
              The recap you were going to write — decisions, owners and next steps, from this
              meeting's own notes. Nothing is invented: an action item with no owner stays
              without one.
            </p>
          </div>
          <Button variant="outline" onClick={() => void generate()} disabled={busy}>
            {busy ? <Spinner /> : <Sparkles className="h-4 w-4" />} {busy ? "Drafting…" : "Draft the email"}
          </Button>
        </div>
        {error && <ErrorNote className="mt-4">{error}</ErrorNote>}
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Mail className="h-4 w-4 text-accent-strong" />
          <Kicker>Follow-up</Kicker>
          {/* Which path produced this matters: the local assembler is plainer
              and stricter, and the reader should know which one they're editing. */}
          <Chip tone={draft.source === "model" ? "accent" : "neutral"}>
            {draft.source === "model" ? "written on-device" : "assembled from your notes"}
          </Chip>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => void generate()} disabled={busy} title="Draft it again">
            {busy ? <Spinner /> : <RefreshCw className="h-4 w-4" />}
          </Button>
          <Button size="sm" variant="outline" onClick={() => void copy()}>
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copied ? "Copied" : "Copy"}
          </Button>
          <Button size="sm" variant="accent" onClick={() => { window.location.href = mailtoUrl(draft, to.trim()); }}>
            <ExternalLink className="h-4 w-4" /> Open in mail
          </Button>
        </div>
      </div>

      <label htmlFor="fu-to" className="ldg-kicker mb-1.5 block">To (optional)</label>
      <input
        id="fu-to"
        value={to}
        onChange={(e) => setTo(e.target.value)}
        placeholder="team@example.com"
        className="mb-4 w-full rounded-xl border border-hairline bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent/40"
      />

      <label htmlFor="fu-subject" className="ldg-kicker mb-1.5 block">Subject</label>
      <input
        id="fu-subject"
        value={draft.subject}
        onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
        className="mb-4 w-full rounded-xl border border-hairline bg-surface px-3 py-2 text-sm text-ink-text outline-none focus:ring-2 focus:ring-accent/40"
      />

      <label htmlFor="fu-body" className="ldg-kicker mb-1.5 block">Body</label>
      <textarea
        id="fu-body"
        value={draft.body}
        onChange={(e) => setDraft({ ...draft, body: e.target.value })}
        rows={14}
        className="w-full resize-y rounded-xl border border-hairline bg-surface px-3 py-2.5 text-[14px] leading-relaxed text-ink-text outline-none focus:ring-2 focus:ring-accent/40"
      />
      {error && <ErrorNote className="mt-4">{error}</ErrorNote>}
    </Card>
  );
}
