// The follow-up email, drafted from the meeting that just happened.
//
// Editable before it goes anywhere: the draft is a starting point, and the one
// thing worse than no draft is a draft that gets sent unread. "Open in mail"
// hands it to whatever mail app the person actually uses rather than asking for
// their mailbox credentials — Ledgeur never needs to see their email.

import { useState } from "react";
import { Mail, Copy, Check, Sparkles, ExternalLink, RefreshCw } from "lucide-react";
import { mailtoUrl, type FollowUpEmail } from "@ledgeur/core";
import { Badge, Button, Card, ErrorNote, Field, IconButton, Input, Label, Spinner, Textarea } from "../ui.tsx";
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
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-1 flex items-center gap-2"><Mail className="h-4 w-4 text-brand-strong" /><Label>Follow-up email</Label></div>
            <p className="text-sm leading-relaxed text-muted">
              The recap you were going to write — decisions, owners and next steps, from this
              meeting's own notes. Nothing is invented: an action item with no owner stays without one.
            </p>
          </div>
          <Button tone="secondary" onClick={() => void generate()} disabled={busy}>
            {busy ? <Spinner /> : <Sparkles className="h-4 w-4" />} {busy ? "Drafting" : "Draft the email"}
          </Button>
        </div>
        {error && <ErrorNote className="mt-4">{error}</ErrorNote>}
      </Card>
    );
  }

  return (
    <Card className="p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Mail className="h-4 w-4 text-brand-strong" />
          <Label>Follow-up email</Label>
          {/* Which path produced this matters: the local assembler is plainer
              and stricter, and the reader should know which one they're editing. */}
          <Badge tone={draft.source === "model" ? "brand" : "neutral"}>
            {draft.source === "model" ? "written on-device" : "assembled from your notes"}
          </Badge>
        </div>
        <div className="flex gap-1.5">
          <IconButton label="Draft it again" size="sm" onClick={() => void generate()} disabled={busy}>
            {busy ? <Spinner /> : <RefreshCw className="h-4 w-4" />}
          </IconButton>
          <Button size="sm" tone="secondary" onClick={() => void copy()}>
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copied ? "Copied" : "Copy"}
          </Button>
          <Button size="sm" onClick={() => { window.location.href = mailtoUrl(draft, to.trim()); }}>
            <ExternalLink className="h-4 w-4" /> Open in mail
          </Button>
        </div>
      </div>

      <div className="space-y-4">
        <Field label="To (optional)" htmlFor="fu-to">
          <Input id="fu-to" value={to} onChange={(e) => setTo(e.target.value)} placeholder="team@example.com" />
        </Field>
        <Field label="Subject" htmlFor="fu-subject">
          <Input id="fu-subject" value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
        </Field>
        <Field label="Body" htmlFor="fu-body">
          <Textarea id="fu-body" value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} rows={14} />
        </Field>
      </div>
      {error && <ErrorNote className="mt-4">{error}</ErrorNote>}
    </Card>
  );
}
