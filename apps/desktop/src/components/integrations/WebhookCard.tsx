// Outbound webhooks: telling another system a meeting finished.
//
// The card leads with what leaves the device, because that is the decision
// being made. Everything else here — the secret, the test button, the last
// delivery — exists so it is possible to know whether it actually works,
// rather than to see a saved URL and assume.

import { useState } from "react";
import { Webhook, Send, Check, TriangleAlert, Eye, EyeOff } from "lucide-react";
import { Badge, Button, Card, ErrorNote, Field, IconButton, Input, Label, Spinner, Toggle } from "../ui.tsx";
import { useSettings, setSetting } from "../../lib/settings.ts";
import { sendTestDelivery, lastDelivery, type DeliveryResult } from "../../lib/webhooks.ts";

export function WebhookCard() {
  const settings = useSettings();
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<DeliveryResult | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const last = lastDelivery();

  async function test() {
    setTesting(true);
    setResult(null);
    try {
      setResult(await sendTestDelivery(settings.webhookUrl, settings.webhookSecret));
    } finally {
      setTesting(false);
    }
  }

  const configured = settings.webhookUrl.trim().length > 0;

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center gap-2">
        <Webhook className="h-4 w-4 text-brand-strong" />
        <Label>Webhook</Label>
        {configured
          ? <Badge tone={last?.ok ? "accent" : last ? "danger" : "neutral"}>
              {last?.ok ? "Delivering" : last ? "Last delivery failed" : "Not yet tested"}
            </Badge>
          : <Badge>Off</Badge>}
      </div>
      <p className="mb-4 max-w-xl text-sm leading-relaxed text-muted">
        POST every finished meeting to a URL you control — Zapier, n8n, a Slack relay, your own CRM.
        Notes, decisions and action items go by default; the transcript only if you turn it on below.
        Voice prints are never sent under any setting.
      </p>

      <div className="space-y-4">
        <Field label="Endpoint" htmlFor="wh-url">
          <Input id="wh-url" value={settings.webhookUrl} onChange={(e) => setSetting("webhookUrl", e.target.value)} placeholder="https://hooks.example.com/ledgeur" />
        </Field>

        <Field
          label="Signing secret (optional)"
          htmlFor="wh-secret"
          hint={<>Signed as <code className="font-mono">X-Ledgeur-Signature: sha256=…</code>, an HMAC-SHA256 over <code className="font-mono">{"<X-Ledgeur-Timestamp>.<body>"}</code> — the same shape GitHub and Stripe use. Without a secret, deliveries are unsigned and the header is omitted.</>}
        >
          <div className="flex items-center gap-2">
            <Input
              id="wh-secret"
              type={showSecret ? "text" : "password"}
              value={settings.webhookSecret}
              onChange={(e) => setSetting("webhookSecret", e.target.value)}
              placeholder="a long random string"
              className="font-mono text-sm"
            />
            <IconButton label={showSecret ? "Hide the secret" : "Show the secret"} tone="secondary" onClick={() => setShowSecret((v) => !v)}>
              {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </IconButton>
          </div>
        </Field>

        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-base font-medium text-ink-text">Include the full transcript</div>
            <p className="mt-0.5 text-xs leading-relaxed text-faint">
              Off by default. The transcript is the most sensitive thing Ledgeur holds, and most
              integrations only need the notes.
            </p>
          </div>
          <Toggle on={settings.webhookIncludeTranscript} onChange={(v) => setSetting("webhookIncludeTranscript", v)} label="Include the full transcript" />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" tone="secondary" onClick={() => void test()} disabled={!configured || testing}>
            {testing ? <Spinner /> : <Send className="h-4 w-4" />} {testing ? "Sending" : "Send a test"}
          </Button>
          {result && (
            result.ok
              ? <span className="inline-flex items-center gap-1.5 text-sm text-accent-strong"><Check className="h-4 w-4" /> Delivered ({result.status}) in {result.attempts} attempt{result.attempts === 1 ? "" : "s"}.</span>
              : <span className="inline-flex items-center gap-1.5 text-sm text-danger"><TriangleAlert className="h-4 w-4" /> {result.error}</span>
          )}
        </div>
      </div>

      {/* Real evidence rather than "configured": what happened, to which
          meeting, and when. */}
      {last && !result && (
        <p className="mt-3 text-xs text-faint">
          Last delivery: <strong className="font-medium">{last.meetingTitle}</strong>, {new Date(last.at).toLocaleString()} —{" "}
          {last.ok ? `delivered (${last.status})` : `failed: ${last.error}`}
        </p>
      )}

      {configured && settings.webhookUrl.startsWith("http://") && !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(settings.webhookUrl) && (
        <ErrorNote className="mt-3">
          That endpoint is plain http://, so nothing will be sent — meeting notes should not travel in clear text. Use an https:// URL.
        </ErrorNote>
      )}
    </Card>
  );
}
