// Outbound webhooks: telling another system a meeting finished.
//
// The card leads with what leaves the device, because that is the decision
// being made. Everything else here — the secret, the test button, the last
// delivery — exists so it is possible to know whether it actually works,
// rather than to see a saved URL and assume.

import { useState } from "react";
import { Webhook, Send, Check, TriangleAlert, Eye, EyeOff } from "lucide-react";
import { Button, Card, Chip, ErrorNote, Kicker, Spinner } from "../ui.tsx";
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
        <Webhook className="h-4 w-4 text-accent-strong" />
        <Kicker>Webhook</Kicker>
        {configured
          ? <Chip tone={last?.ok ? "accent" : last ? "danger" : "neutral"}>
              {last?.ok ? "delivering" : last ? "last delivery failed" : "not yet tested"}
            </Chip>
          : <Chip>off</Chip>}
      </div>
      <p className="mb-4 text-xs leading-relaxed text-muted">
        POST every finished meeting to a URL you control — Zapier, n8n, a Slack relay, your own CRM.
        Notes, decisions and action items go by default; the transcript only if you tick it below.
        Voice prints are never sent under any setting.
      </p>

      <label htmlFor="wh-url" className="ldg-kicker mb-1.5 block">Endpoint</label>
      <input
        id="wh-url"
        value={settings.webhookUrl}
        onChange={(e) => setSetting("webhookUrl", e.target.value)}
        placeholder="https://hooks.example.com/ledgeur"
        className="mb-3 w-full rounded-lg border border-hairline bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent/40"
      />

      <label htmlFor="wh-secret" className="ldg-kicker mb-1.5 block">Signing secret (optional)</label>
      <div className="mb-1 flex items-center gap-2">
        <input
          id="wh-secret"
          type={showSecret ? "text" : "password"}
          value={settings.webhookSecret}
          onChange={(e) => setSetting("webhookSecret", e.target.value)}
          placeholder="a long random string"
          className="min-w-0 flex-1 rounded-lg border border-hairline bg-surface px-3 py-2 font-mono text-xs outline-none focus:ring-2 focus:ring-accent/40"
        />
        <button
          type="button"
          onClick={() => setShowSecret((v) => !v)}
          aria-label={showSecret ? "Hide the secret" : "Show the secret"}
          className="shrink-0 rounded-lg border border-hairline p-2 text-faint hover:text-ink-text"
        >
          {showSecret ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </button>
      </div>
      <p className="mb-4 text-[11px] leading-relaxed text-faint">
        Signed as <code className="font-mono">X-Ledgeur-Signature: sha256=…</code>, an HMAC-SHA256 over
        <code className="font-mono"> {"<X-Ledgeur-Timestamp>.<body>"}</code> — the same shape GitHub and
        Stripe use, so your receiver can verify it with code it already has. Without a secret, deliveries
        are unsigned and the header is omitted entirely.
      </p>

      <label className="mb-4 flex cursor-pointer items-start gap-2.5">
        <input
          type="checkbox"
          checked={settings.webhookIncludeTranscript}
          onChange={(e) => setSetting("webhookIncludeTranscript", e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-hairline-strong accent-[var(--accent-strong,#1f6f4a)]"
        />
        <span className="text-[12.5px] leading-relaxed text-ink-text">
          Include the full transcript
          <span className="block text-[11px] text-faint">
            Off by default. The transcript is the most sensitive thing Ledgeur holds, and most
            integrations only need the notes.
          </span>
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => void test()} disabled={!configured || testing}>
          {testing ? <Spinner /> : <Send className="h-4 w-4" />} {testing ? "Sending…" : "Send a test"}
        </Button>
        {result && (
          result.ok
            ? <span className="inline-flex items-center gap-1.5 text-xs text-accent-strong"><Check className="h-3.5 w-3.5" /> Delivered ({result.status}) in {result.attempts} attempt{result.attempts === 1 ? "" : "s"}.</span>
            : <span className="inline-flex items-center gap-1.5 text-xs text-danger"><TriangleAlert className="h-3.5 w-3.5" /> {result.error}</span>
        )}
      </div>

      {/* Real evidence rather than "configured": what happened, to which
          meeting, and when. */}
      {last && !result && (
        <p className="mt-3 text-[11px] text-faint">
          Last delivery: <strong className="font-medium">{last.meetingTitle}</strong>, {new Date(last.at).toLocaleString()} —{" "}
          {last.ok ? `delivered (${last.status})` : `failed: ${last.error}`}
        </p>
      )}

      {configured && settings.webhookUrl.startsWith("http://") && !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(settings.webhookUrl) && (
        <ErrorNote className="mt-3">
          That endpoint is plain <code className="font-mono">http://</code>, so nothing will be sent —
          meeting notes should not travel in clear text. Use an <code className="font-mono">https://</code> URL.
        </ErrorNote>
      )}
    </Card>
  );
}
